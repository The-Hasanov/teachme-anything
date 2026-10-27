import type { EngineInterface } from 'claude-code'

import type { Segment, Step } from '../engine/types'
import { mkdirp, output, rmrf, runCommand, runProbes, scaffold } from './adapters'
import type { Os } from './adapters'

export type VerifyResult = { ok: boolean; errors: string[]; ms: number }

export async function tempRoot($: EngineInterface, os: Os) {
  const base = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? (os === 'windows' ? 'C:/Windows/Temp' : '/tmp')
  return `${base.replace(/\\/g, '/').replace(/\/$/, '')}/teachme-verify-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export async function verifySegment($: EngineInterface, seg: Segment, os: Os): Promise<VerifyResult> {
  const t0 = await $.clock.now()
  const errors: string[] = []
  const examples = seg.steps.filter(x => x.code?.run)
  if (!examples.length && !seg.practice) return { ok: true, errors, ms: 0 }
  const dir = await tempRoot($, os)
  try {
    const bad = seg.practice ? await scaffold($, dir, seg.practice.scaffold, os) : (await mkdirp($, dir, os), undefined)
    if (bad) return { ok: false, errors: [`scaffold failed: ${bad}`], ms: (await $.clock.now()) - t0 }
    for (const step of examples) errors.push(...await verifyExample($, dir, step))
    for (const step of seg.steps) {
      if (!step.check) continue
      const before = await runProbes($, dir, step.check.probes)
      if (before.every(r => r.ok)) errors.push(`${step.id}: the check passes before the task is done`)
      for (const cmd of step.check.reference) {
        const r = await runCommand($, dir, cmd)
        if (!r.ok) { errors.push(`${step.id}: reference command failed: ${cmd.join(' ')}: ${r.out}`); break }
      }
      const after = await runProbes($, dir, step.check.probes)
      for (const r of after) if (!r.ok) errors.push(`${step.id}: probe ${r.id} fails on the reference solution (got "${r.got}")`)
    }
  } finally {
    await rmrf($, dir, os).catch(() => undefined)
  }
  return { ok: errors.length === 0, errors, ms: (await $.clock.now()) - t0 }
}

const norm = (s: string) => s.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim()

async function verifyExample($: EngineInterface, dir: string, step: Step): Promise<string[]> {
  const run = step.code!.run!
  await $.fs.write(`${dir}/${run.file}`, step.code!.source)
  const r = await output($, dir, run.argv)
  if (!r.ok) return [`${step.id}: the example fails: ${run.argv.join(' ')}: ${r.err}`]
  const errors: string[] = []
  if (norm(r.out) !== norm(run.out)) errors.push(`${step.id}: the example prints "${norm(r.out).slice(0, 120)}", the step says "${norm(run.out).slice(0, 120)}"`)
  const said = step.kind === 'predict' && step.key?.length === 1 ? step.choices?.[step.key[0]!]?.code ?? step.choices?.[step.key[0]!]?.text
    : step.kind === 'trace' ? step.key?.map(k => step.choices?.[k]?.text).join('\n') : undefined
  if (said !== undefined && norm(said) !== norm(r.out)) errors.push(`${step.id}: the answer key says "${said}", the code prints "${norm(r.out).slice(0, 120)}"`)
  return errors
}
