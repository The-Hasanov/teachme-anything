import type { EngineInterface } from 'claude-code'

import type { ProbeResult } from '../engine/engine'
import type { Probe } from '../engine/types'

export type Os = 'windows' | 'mac' | 'linux'
export type Env = { os: Os; shell: string; editor: string; tools: Record<string, string | null>; ms: number }

const TOOLS: Record<string, string[]> = {
  git: ['git', '--version'],
  docker: ['docker', '--version'],
  podman: ['podman', '--version'],
  node: ['node', '--version'],
  python: ['python', '--version'],
  cargo: ['cargo', '--version'],
}
export const isTool = (adapter: string) => adapter in TOOLS

let python = 'python'
const BUILD_MS = 120_000

async function run($: EngineInterface, argv: readonly string[], cwd?: string, timeoutMs = 15_000) {
  if (argv[0] === 'python') argv = [python, ...argv.slice(1)]
  try {
    return await $.process.run(argv, { ...(cwd ? { cwd } : {}), timeoutMs })
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) }
  }
}

export async function output($: EngineInterface, dir: string, argv: readonly string[]) {
  const r = await run($, argv, dir)
  return { ok: r.exitCode === 0, out: r.stdout, err: r.stderr.trim().slice(0, 300) }
}

export async function osOf($: EngineInterface): Promise<Os> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  const u = await run($, ['uname', '-s'])
  return /darwin/i.test(u.stdout) ? 'mac' : 'linux'
}

export async function probeEnv($: EngineInterface): Promise<Env> {
  const t0 = await $.clock.now()
  const [os, termProgram, vscodePid, shellEnv, comspec] = await Promise.all([
    osOf($), $.env.get('TERM_PROGRAM'), $.env.get('VSCODE_PID'), $.env.get('SHELL'), $.env.get('ComSpec'),
  ])
  const versions = await Promise.all(Object.entries(TOOLS).map(async ([name, argv]) => {
    let r = await run($, argv, undefined, 8000)
    if (name === 'python' && r.exitCode !== 0) {
      r = await run($, ['python3', '--version'], undefined, 8000)
      if (r.exitCode === 0) python = 'python3'
    }
    return [name, r.exitCode === 0 ? (r.stdout || r.stderr).trim().split('\n')[0]!.slice(0, 80) : null] as const
  }))
  return {
    os,
    shell: shellEnv ? shellEnv.split(/[\\/]/).pop()! : os === 'windows' ? (comspec ? 'PowerShell or cmd' : 'cmd') : 'sh',
    editor: termProgram === 'vscode' || vscodePid ? 'VS Code' : 'terminal',
    tools: Object.fromEntries(versions),
    ms: (await $.clock.now()) - t0,
  }
}

export function installPlan(tool: string, os: Os): { label: string; argv: string[] }[] {
  const winget = (id: string) => ['winget', 'install', '--id', id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent']
  const plans: Record<string, Partial<Record<Os, { label: string; argv: string[] }[]>>> = {
    git: { windows: [{ label: 'winget install Git.Git', argv: winget('Git.Git') }], mac: [{ label: 'brew install git', argv: ['brew', 'install', 'git'] }] },
    podman: { windows: [{ label: 'winget install RedHat.Podman', argv: winget('RedHat.Podman') }], mac: [{ label: 'brew install podman', argv: ['brew', 'install', 'podman'] }] },
    python: { windows: [{ label: 'winget install Python.Python.3.13', argv: winget('Python.Python.3.13') }], mac: [{ label: 'brew install python', argv: ['brew', 'install', 'python'] }] },
    node: { windows: [{ label: 'winget install OpenJS.NodeJS.LTS', argv: winget('OpenJS.NodeJS.LTS') }], mac: [{ label: 'brew install node', argv: ['brew', 'install', 'node'] }] },
  }
  return plans[tool]?.[os] ?? []
}

export const MANUAL: Record<string, string> = {
  git: 'https://git-scm.com/downloads',
  podman: 'https://podman.io/docs/installation',
  python: 'https://www.python.org/downloads/',
  node: 'https://nodejs.org/en/download',
  cargo: 'https://rustup.rs',
}

export async function mkdirp($: EngineInterface, dir: string, os: Os) {
  await run($, os === 'windows' ? ['cmd', '/d', '/c', 'mkdir', dir.replace(/\//g, '\\')] : ['mkdir', '-p', dir])
}

export async function rmrf($: EngineInterface, dir: string, os: Os) {
  if (!/teachme-verify-/.test(dir)) throw new Error(`refusing to remove ${dir}`)
  await run($, os === 'windows' ? ['cmd', '/d', '/c', 'rmdir', '/s', '/q', dir.replace(/\//g, '\\')] : ['rm', '-rf', dir])
}

export async function runCommand($: EngineInterface, dir: string, cmd: readonly string[]): Promise<{ ok: boolean; out: string }> {
  if (cmd[0] === '@write') {
    const file = cmd[1] ?? ''
    if (!file || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/.test(file)) return { ok: false, out: `bad @write path ${file}` }
    await $.fs.write(`${dir}/${file}`, cmd[2] ?? '')
    return { ok: true, out: '' }
  }
  const r = await run($, cmd, dir, BUILD_MS)
  return { ok: r.exitCode === 0, out: `${r.stdout}\n${r.stderr}`.trim().slice(0, 400) }
}

export async function scaffold($: EngineInterface, dir: string, cmds: readonly (readonly string[])[], os: Os): Promise<string | undefined> {
  await mkdirp($, dir, os)
  for (const cmd of cmds) {
    const r = await runCommand($, dir, cmd)
    if (!r.ok) return `${cmd.join(' ')}: ${r.out}`
  }
  return undefined
}

export async function runProbes($: EngineInterface, dir: string, probes: readonly Probe[]): Promise<ProbeResult[]> {
  return Promise.all(probes.map(async p => {
    const r = await run($, p.argv, dir, BUILD_MS)
    const out = r.stdout.replace(/\r\n/g, '\n').trim()
    const got = out || r.stderr.trim().slice(-400) || (r.exitCode === 0 ? '' : `exit ${r.exitCode}`)
    const e = p.expect
    const ok = (e.exitCode === undefined ? (e.equals === undefined && e.matches === undefined ? r.exitCode === 0 : true) : r.exitCode === e.exitCode)
      && (e.equals === undefined || out === e.equals)
      && (e.matches === undefined || new RegExp(e.matches, 'm').test(out))
    return { id: p.id, ok, got }
  }))
}
