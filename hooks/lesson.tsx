import { atom, read, update } from 'claude-code'

import * as bigo from '../courses/bigo'
import * as git from '../courses/git'
import * as python from '../courses/python'
import * as sql from '../courses/sql'
import type { AgentSpawnArgs, AgentSpawnResult, EngineInterface, Register } from 'claude-code'

import { checked, current, level, press, screen, setupDone, snapshot, taught, withProject } from './engine/engine'
import type { Ctx, Out } from './engine/engine'
import { replay } from './engine/engine'
import type { Build, Course, Effect, LogEvent, Line, Phase, Press, ProjectPick, Screen, Segment } from './engine/types'
import { skillState } from './engine/mastery'
import { migrate } from './engine/migrate'
import { milestoneErrors, untaught, validateCourse, validateProjectPhase, validateSegment } from './engine/schema'
import { MANUAL, installPlan, isTool, output, probeEnv, runCommand, runProbes, scaffold } from './host/adapters'
import type { Env, Os } from './host/adapters'
import { stats, statsText } from './engine/stats'
import { DIR, append, hasCourse, install, load, newLog, progressMarkdown } from './host/store'
import type { Log } from './host/store'
import { AUTHOR_MODEL, AUTHOR_PROMPT, DOCTOR_PROMPT, GENERIC_INTAKE, SETUP_ADAPTERS, authorTask, courseTask, diagnose, projectTask } from './host/teacher'
import { verifySegment } from './host/verify'
import { newVsCode, sendView, tick } from './host/vscode'
import type { LayoutOp, VsCode } from './host/vscode'

const PLUGIN = 'teachme-anything'
const PANE = 'teach'
const SPARK = '▁▂▃▄▅▆▇█'
const OUT_ERR = /^(Traceback|\s+File "|\w*(Error|Exception)\b|error[:[]|fatal:|ERROR\b|FAIL\b)/
const OUT_WARN = /^(warning[:[]|Warning\b|WARN\b|hint:)/i
const TOOL = (name: string) => `mcp__${PLUGIN}__${name}`
const OWN_TOOLS = new Set(['start_course', 'snapshot', 'progress', 'submit_segment', 'submit_course', 'build_with_me', 'submit_project'].map(TOOL))

const view = atom({ plugin: 'teachme-anything', key: 'screen' } as const, null, { shape: 'screen-1' })

type Session = {
  root: string
  os: Os
  course?: Course
  segments: Record<string, Segment>
  state: ReturnType<typeof replay>
  log: Log
  metrics: Log
  env?: Env
  welcome: boolean
  progress?: boolean
  busy?: string
  preparing?: string
  prepAgent?: string
  prepError?: string
  prepSince?: number
  healAgent?: string
  build?: Build & { open: boolean; agent?: string }
  lastProbes?: { id: string; ok: boolean; got: string }[]
  vscode?: VsCode
  reveal?: Reveal
  // Ask: the prompt sent to the agent for this step, the turn that answers it, and its answer
  asking?: { step: string; prompt: string; question?: string; turn?: string; answer?: string }
}

let sess: Session | undefined

async function deviceOf($: EngineInterface) {
  let id = (await $.store.get('device')) as string | undefined
  if (!id) { id = `d${Math.random().toString(36).slice(2, 10)}`; await $.store.set('device', id) }
  return id
}

async function ctx($: EngineInterface): Promise<Ctx> {
  const s = sess!
  return { state: s.state, course: s.course, segments: s.segments, now: await $.clock.now(), welcome: s.welcome, busy: s.busy, progress: s.progress, preparing: !!s.preparing, prepSince: s.preparing ? s.prepSince : undefined, prepError: s.prepError, build: s.build?.open ? s.build : undefined, asked: askedHere(s) }
}

const askedHere = (s: Session) => {
  const a = s.asking
  return a && s.state.aside && s.state.pos && s.segments[s.state.pos.seg]?.steps[s.state.pos.step]?.id === a.step
    ? { ...(a.question ? { question: a.question } : {}), ...(a.answer ? { answer: a.answer } : {}) } : undefined
}

// One poller per folder: a second one would keep polling and dispatch every press twice
type Reveal = Extract<LayoutOp, { op: 'reveal' }>

const vsCodeFor = ($: EngineInterface, root: string) =>
  sess?.vscode?.root === root ? sess.vscode : newVsCode(root, (p, t) => { void dispatch($, p, t) }, () => { void refresh($, takeReveal()) })

const takeReveal = () => {
  const reveal = sess?.reveal
  if (sess) sess.reveal = undefined
  return reveal
}

async function openInVsCode($: EngineInterface) {
  const s = sess
  if (!s) return
  const at = current(await ctx($))
  const dir = practiceDir(s, at?.seg)
  const reveal: Reveal = { op: 'reveal', ...(dir ? { cwd: dir } : {}), ...(dir && at?.step.open ? { path: `${dir}/${at.step.open}` } : {}) }
  if (s.vscode?.isUp) return refresh($, reveal)
  s.reveal = reveal
  const args = [s.root, ...(reveal.path ? [reveal.path] : [])]
  const opened = await output($, s.root, s.os === 'windows' ? ['cmd', '/c', 'code', ...args] : ['code', ...args])
  if (opened.ok) return
  s.reveal = undefined
  void $.ui.toast(`VS Code did not open (${opened.err || 'no code command'}). In VS Code, run "Shell Command: Install 'code' command in PATH".`)
}

const practiceDir = (s: Session, seg?: Segment) => seg?.practice ? `${s.root}/${seg.practice.dir}` : undefined

async function metric($: EngineInterface, m: Record<string, unknown>) {
  if (sess) void append($, sess.metrics, [{ ts: await $.clock.now(), ...m }])
}

async function refresh($: EngineInterface, layout?: LayoutOp) {
  const s = sess
  if (!s) return
  const sc = screen(await ctx($))
  await update($, view, () => sc)
  if (s.vscode) void sendView($, s.vscode, sc, layout)
}

async function commit($: EngineInterface, out: Out) {
  const s = sess!
  if (out.events.length) {
    s.state = out.events.reduce((st, e) => replayOne(st, e), s.state)
    void append($, s.log, out.events)
  }
  await refresh($)
  if (out.events.length && s.course) void $.fs.write(`${s.root}/PROGRESS.md`, progressMarkdown(s.course, s.state, out.events.at(-1)!.ts)).catch(() => undefined)
  for (const fx of out.effects) void run($, fx)
}

const replayOne = (st: Session['state'], e: LogEvent) => replay([e], st)

export async function dispatch($: EngineInterface, p: Press, sentAt?: number) {
  const s = sess
  if (!s) return
  const t0 = await $.clock.now()
  if (s.build?.open) return buildPress($, p)
  if ('action' in p && p.action === 'progress') { s.progress = true; return refresh($) }
  if ('action' in p && p.action === 'back') s.asking = undefined
  if (s.progress) { if ('action' in p && p.action === 'back') { s.progress = false; await refresh($) } return }
  if (s.welcome && 'action' in p && (p.action === 'continue' || p.action === 'curriculum')) {
    const out = press(await ctx($), p)
    s.welcome = false
    await commit($, out)
    const dir = practiceDir(s, current(await ctx($))?.seg)
    if (dir) await refresh($, { op: 'terminal', cwd: dir })
  } else {
    const before = current(await ctx($))?.step.id
    await commit($, press(await ctx($), p))
    const at = current(await ctx($))
    const dir = practiceDir(s, at?.seg)
    if (at && at.step.id !== before && at.step.open && dir) await refresh($, { op: 'practice', path: `${dir}/${at.step.open}` })
  }
  const t1 = await $.clock.now()
  void metric($, { kind: 'press', press: p, ms: t1 - t0, ...(sentAt ? { fromView: t1 - sentAt } : {}) })
}

// The effects run() handles. tests/invariants checks that the engine asks for no other; run() throws on one it can't do.
export const HANDLED_EFFECTS: readonly Effect['kind'][] = ['check', 'escalate', 'setup', 'heal', 'practice', 'prepare', 'remedy', 'ask']

async function run($: EngineInterface, fx: Effect) {
  const s = sess!
  try {
    if (!HANDLED_EFFECTS.includes(fx.kind)) throw new Error('no handler for this effect')
    if (fx.kind === 'check') {
      const at = current(await ctx($))
      const dir = practiceDir(s, at?.seg)
      if (!at?.step.check || !dir) return
      s.busy = 'Checking…'
      await refresh($)
      const t0 = await $.clock.now()
      const results = await runProbes($, dir, at.step.check.probes)
      s.lastProbes = results
      s.busy = undefined
      void metric($, { kind: 'check', step: at.step.id, ms: (await $.clock.now()) - t0 })
      return commit($, checked(await ctx($), at.step.id, results))
    }
    if (fx.kind === 'escalate') {
      const at = current(await ctx($))
      if (!at || !s.course) return
      const dir = practiceDir(s, at.seg)
      const all = s.lastProbes ?? (dir && at.step.check ? await runProbes($, dir, at.step.check.probes) : [])
      const d = await diagnose($, s.course, at.step, fx.probe, fx.got, all)
      void metric($, { kind: 'escalate', step: at.step.id, ms: d.ms, model: d.model, usage: d.usage })
      return commit($, taught(await ctx($), fx.esc, d))
    }
    if (fx.kind === 'setup') return runSetup($)
    if (fx.kind === 'heal') return heal($)
    if (fx.kind === 'practice') return ensurePractice($, fx.dir, fx.seg)
    if (fx.kind === 'prepare') return prepare($, fx.after, fx.seg)
    if (fx.kind === 'remedy') return remedy($, fx.tag, fx.skill)
    if (fx.kind === 'ask') return ask($, fx.question)
    throw new Error('no handler for this effect')
  } catch (err) {
    s.busy = undefined
    $.ui.log(`teachme: ${fx.kind} failed: ${err}`, { to: 'debug' })
    await refresh($)
  }
}

// Ask: the step goes to the agent in the chat, and its answer shows under the step too (#14)
async function ask($: EngineInterface, question?: string) {
  const s = sess!
  const at = current(await ctx($))
  if (!at) return
  const prompt = [
    question ? `About the Teach Me step "${at.step.title}": ${question}` : `Explain the idea behind the Teach Me step "${at.step.title}" in more depth.`,
    'Follow the explain-step way: never give away an answer the learner has not found yet. Up to 6 short sentences, plain words, no headings.',
    `<teachme-position>\n${snapshot(await ctx($))}\n</teachme-position>`,
  ].join('\n\n')
  s.asking = { step: at.step.id, prompt, ...(question ? { question } : {}) }
  await refresh($)
  void metric($, { kind: 'ask', step: at.step.id, own: !!question })
  const r = await $.prompt.submit({ text: prompt })
  if (r.drop && s.asking?.prompt === prompt) { s.asking = { ...s.asking, answer: `Ask in the chat. Your place here is kept. (${r.drop})` }; await refresh($) }
}

async function ensurePractice($: EngineInterface, rel: string, segId?: string) {
  const s = sess!
  const dir = `${s.root}/${rel}`
  const seg = (segId ? s.segments[segId] : undefined) ?? Object.values(s.segments).find(g => g.practice?.dir === rel)
  if (seg?.practice && !(await $.fs.exists(dir))) await scaffold($, dir, seg.practice.scaffold, s.os)
  // The system's part of a milestone: boilerplate, wiring and tests, written once into the learner's folder
  if (seg?.practice?.adds && !s.state.added[seg.id]) {
    const bad = await scaffold($, dir, seg.practice.adds, s.os)
    if (bad) { $.ui.log(`teachme: adds for ${seg.id} failed: ${bad}`, { to: 'debug' }); void metric($, { kind: 'adds-failed', seg: seg.id }) }
    else await commit($, { events: [{ ts: await $.clock.now(), type: 'added', seg: seg.id }], effects: [] })
  }
  await refresh($, { op: 'terminal', cwd: dir })
}

const inProject = (s: Session, segId: string) => !!s.course?.phases.some(p => p.project && p.segments.includes(segId))

async function runSetup($: EngineInterface) {
  const s = sess!
  if (!s.course || s.busy) return
  const now = async () => $.clock.now()
  const set = async (req: string, status: 'ok' | 'running' | 'failed', note?: string) =>
    commit($, { events: [{ ts: await now(), type: 'setup', req, status, ...(note ? { note } : {}) }], effects: [] })
  const t0 = await now()
  for (const r of s.course.setup) {
    if (s.state.setup[r.id]?.status === 'ok') continue
    await set(r.id, 'running')
    if (isTool(r.adapter)) {
      let version = s.env?.tools[r.adapter] || (s.env = envCache = await probeEnv($)).tools[r.adapter]
      for (const step of version ? [] : installPlan(r.adapter, s.os)) {
        await set(r.id, 'running', step.label)
        await runCommand($, s.root, step.argv)
        s.env = envCache = await probeEnv($)
        version = s.env.tools[r.adapter]
        if (version) break
      }
      await (version ? set(r.id, 'ok', version) : set(r.id, 'failed', `Install it from ${MANUAL[r.adapter] ?? 'its website'}, then press Set up again.`))
      if (!version) break
    } else if (r.adapter === 'practice') {
      const segs = Object.values(s.segments).filter(g => g.practice && !inProject(s, g.id))
      for (const g of segs) if (!(await $.fs.exists(`${s.root}/${g.practice!.dir}`))) {
        const bad = await scaffold($, `${s.root}/${g.practice!.dir}`, g.practice!.scaffold, s.os)
        if (bad) { await set(r.id, 'failed', bad); return }
      }
      await set(r.id, 'ok', segs.map(g => g.practice!.dir).join(', '))
    } else if (r.adapter === 'verify') {
      const bad: string[] = []
      for (const g of Object.values(s.segments)) {
        const v = await verifySegment($, g, s.os)
        void metric($, { kind: 'verify', seg: g.id, ms: v.ms, ok: v.ok })
        if (!v.ok) { bad.push(...v.errors); delete s.segments[g.id] }
      }
      const n = Object.keys(s.segments).length
      await (bad.length ? set(r.id, 'failed', bad[0]) : set(r.id, 'ok', n ? `${n} ${n === 1 ? 'lesson' : 'lessons'} checked` : 'Each lesson is checked before you see it'))
    } else {
      await set(r.id, 'ok')
    }
  }
  void metric($, { kind: 'setup', ms: (await now()) - t0 })
}

const remedies = new Set<string>()
const HEALING = 'Fixing your setup…'

async function recheck($: EngineInterface) {
  const s = sess
  if (!s?.course) return 'No Teach Me course in this folder.'
  if (s.busy === HEALING) s.busy = undefined
  await runSetup($)
  return s.course.setup.map(r => `${s.state.setup[r.id]?.status === 'ok' ? '✓' : '✗'} ${r.title}${s.state.setup[r.id]?.note ? `: ${s.state.setup[r.id]!.note}` : ''}`).join('\n')
}

async function heal($: EngineInterface) {
  const s = sess!
  if (!s.course || s.busy || s.healAgent) return
  const failed = s.course.setup.filter(r => s.state.setup[r.id]?.status === 'failed').map(r => `- ${r.title} (adapter ${r.adapter}): ${s.state.setup[r.id]!.note ?? 'failed'}`)
  s.busy = HEALING
  await refresh($)
  s.healAgent = RELAYING
  await spawnAgent($, {
    subagentType: `${PLUGIN}:doctor`, description: 'Teach Me: fix the setup',
    prompt: [`OS: ${s.os}. Folder: ${s.root}. Tools the engine found: ${JSON.stringify(s.env?.tools ?? {})}.`, 'Failed setup items:', ...failed].join('\n'),
  }, async r => {
    if (r.deny) { s.busy = undefined; s.healAgent = undefined; $.ui.log(`teachme: doctor not started: ${r.deny}`, { to: 'debug' }); await refresh($) }
    else s.healAgent = r.agentId
    void metric($, { kind: 'heal', items: failed.length, started: !r.deny })
  })
}

async function remedy($: EngineInterface, tag: string, skill?: string) {
  const s = sess!
  if (!s.course || remedies.has(tag)) return
  remedies.add(tag)
  const n = Object.keys(s.segments).filter(id => id.startsWith(`remedy-${tag}-`)).length + 1
  const belief = s.course.skills.flatMap(k => k.misconceptions).find(m => m.tag === tag)?.belief ?? tag
  const seen = Object.values(s.segments).flatMap(g => g.steps).filter(x => x.remedy === tag || x.wrong?.some(w => w.tag === tag)).map(x => `"${x.title}": ${x.body}`)
  await spawnAgent($, {
    subagentType: `${PLUGIN}:author`, model: AUTHOR_MODEL, description: 'Teach Me: a new angle for a mistake',
    prompt: [
      `Write segment "remedy-${tag}-${n}": two drill steps (drill: true, remedy: "${tag}", kind "mcq" or "predict", skill "${skill ?? ''}", no practice, no check) for this misconception: ${belief}.`,
      'Use an explanation angle and a contrasting example the learner has NOT seen. They already saw:', ...seen.slice(0, 6),
      `Learner snapshot:\n${snapshot(await ctx($))}`, `Course:\n${JSON.stringify(s.course)}`,
    ].join('\n'),
  }, r => { void metric($, { kind: 'remedy', tag, started: !r.deny }) })
}

// An agent spawned by the plugin's own code outside a hook (a press handled after its hook returned, the VS Code
// poller, a timer) runs under the plugin's own origin, and the engine skips all of this plugin's hooks for that
// agent's tool calls: its submit_segment then fails with "no tool.call hook answered this call" (#13). The ends of
// agents reach us all the same, so each agent is started from the turn.complete hook of a one-line relay agent:
// a hook frame of the engine's, under which its calls reach our tool.call hooks.
const RELAYING = 'relaying'
const relays = new Map<string, () => Promise<void>>()
type Spawned = Pick<AgentSpawnResult, 'agentId'> & { deny?: string }

async function spawnAgent($: EngineInterface, spec: AgentSpawnArgs, then: (r: Spawned) => void | Promise<void>): Promise<Spawned> {
  const relay: Spawned = await $.agent.spawn({ subagentType: `${PLUGIN}:relay`, description: spec.description ?? 'Teach Me', prompt: 'Reply OK.' })
  if (relay.deny || !relay.agentId) { await then(relay.deny ? relay : { deny: 'the relay agent did not start' }); return relay }
  relays.set(relay.agentId, async () => { await then(await $.agent.spawn(spec)) })
  return relay
}

const authorEndReason = (answer: string) => {
  const said = answer.trim().split('\n').find(line => line.trim())?.trim().slice(0, 300)
  return said ? `the author stopped without submitting it, saying: ${said}` : 'the author stopped without submitting it and gave no reason'
}

async function prepare($: EngineInterface, after: string, target?: string) {
  const s = sess!
  if (!s.course || s.preparing) return
  const order = s.course.phases.flatMap(p => p.segments)
  const nextId = target ?? order[order.indexOf(after) + 1]
  if (!nextId || s.segments[nextId]) return
  const phase = s.course.phases.find(p => p.segments.includes(nextId))
  s.preparing = nextId
  s.prepError = undefined
  s.prepSince = await $.clock.now()
  s.prepAgent = undefined
  await refresh($)
  await spawnAgent($, {
    subagentType: `${PLUGIN}:author`, model: AUTHOR_MODEL, description: 'Teach Me: prepare the next lesson',
    prompt: authorTask(s.course, s.segments[after] ?? python.lists1, snapshot(await ctx($)), nextId, phase?.title ?? ''),
  }, async r => {
    if (r.deny) { s.preparing = undefined; $.ui.log(`teachme: author not started: ${r.deny}`, { to: 'debug' }); await refresh($) }
    else if (s.preparing === nextId) s.prepAgent = r.agentId
    void metric($, { kind: 'prepare', seg: nextId, started: !r.deny })
  })
}

async function submitSegment($: EngineInterface, input: { segment: unknown; newSkills?: Course['skills'] }) {
  const s = sess
  if (!s?.course) return { ok: false, errors: ['no course in this folder'] }
  const course: Course = input.newSkills?.length ? { ...s.course, skills: [...s.course.skills, ...input.newSkills.filter(k => !s.course!.skills.some(x => x.id === k.id))] } : s.course
  const seg = input.segment as Segment
  const errors = validateSegment(seg, course)
  const project = course.phases.find(p => p.project && p.segments.includes(seg?.id))
  if (!errors.length) errors.push(...untaught(seg, Object.values(s.segments)), ...(project ? milestoneErrors(seg, project, Object.values(s.segments)) : []))
  // A rejection is kept, so a failed attempt says why instead of failing silently
  const reject = (errs: string[]) => {
    s.prepError = errs[0]
    void metric($, { kind: 'segment-rejected', seg: seg?.id, errors: errs.slice(0, 3) })
    return { ok: false, errors: errs }
  }
  if (errors.length) return reject(errors)
  const v = await verifySegment($, seg, s.os)
  if (!v.ok) return reject(v.errors)
  const phases = course.phases.map(p => p.segments.includes(seg.id) ? { ...p, skills: [...new Set([...p.skills, ...seg.skills])] } : p)
  s.course = { ...course, phases }
  s.segments[seg.id] = seg
  if (s.preparing === seg.id) s.preparing = undefined
  await install($, s.root, s.course, [seg])
  void metric($, { kind: 'segment', seg: seg.id, verifyMs: v.ms })
  await refresh($)
  return { ok: true, id: seg.id }
}

async function open($: EngineInterface, root: string) {
  const device = await deviceOf($)
  const l = await load($, root)
  if (l.errors.length) $.ui.log(`teachme: ${l.errors.join('; ')}`, { to: 'debug' })
  sess = {
    root, os: (await probeEnvCached($)).os, course: l.course, segments: l.segments, state: l.state,
    log: newLog(root, device), metrics: newLog(root, device, 'metrics'), welcome: l.state.stage === 'lesson', env: await probeEnvCached($),
    vscode: vsCodeFor($, root),
  }
  await refresh($)
  // A finished segment whose next one is missing: the author of an earlier session is gone, so write it now
  const done = l.state.done
  if (done && l.course) {
    const order = l.course.phases.flatMap(p => p.segments)
    const next = order[order.indexOf(done) + 1]
    if (next && !l.segments[next]) void prepare($, done)
  }
}

let envCache: Env | undefined
async function probeEnvCached($: EngineInterface) {
  envCache ??= await probeEnv($)
  return envCache
}

const LIBRARY: { match: RegExp; course: Course; segments: Segment[] }[] = [
  { match: /\bgit\b/i, course: git.course, segments: git.segments },
  { match: /\bpython\b/i, course: python.course, segments: python.segments },
  { match: /\bsql\b|sqlite|database quer/i, course: sql.course, segments: sql.segments },
  { match: /big[- ]?o\b|complexity/i, course: bigo.course, segments: bigo.segments },
]

async function generateCourse($: EngineInterface, subject: string, root: string, background?: string, project?: ProjectPick) {
  const env = await probeEnvCached($)
  const id = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'course'
  const provisional: Course = { format: 'teachme.course/1', id, subject, goal: subject, intake: GENERIC_INTAKE, skills: [], phases: [], setup: [] }
  const device = await deviceOf($)
  sess = {
    root, os: env.os, course: provisional, segments: {}, state: replay([]),
    log: newLog(root, device), metrics: newLog(root, device, 'metrics'), welcome: false, env, busy: 'Writing your course: about a minute.',
    vscode: vsCodeFor($, root),
  }
  const t0 = await $.clock.now()
  await commit($, { events: [{ ts: t0, type: 'course', course: id }], effects: [] })
  await $.ui.open({ id: PANE, title: subject })
  const tools = Object.entries(env.tools).filter(([, v]) => v).map(([k, v]) => `${k} (${v})`).join(', ')
  const relay = await spawnAgent($, {
    subagentType: `${PLUGIN}:author`, model: AUTHOR_MODEL, description: `Teach Me: a new course on ${subject}`,
    prompt: courseTask(subject, `${env.os}; ${tools || 'no developer tools found'}`, { course: python.course, segment: python.lists1 }, background, project),
  }, r => { void metric($, { kind: 'generate', subject, started: !r.deny }) })
  if (relay.deny) return { ok: false, reason: `the course author could not start: ${relay.deny}` }
  return { ok: true, course: subject, generating: true, ...(background ? { writtenFor: background } : {}), next: 'The lesson view asks 3 questions while a course is written for this learner (about a minute). Say one short line; nothing else to do.' }
}

async function buildWithMe($: EngineInterface, a: { suggestions?: ProjectPick[]; idea?: string; subject?: string }) {
  const root = await $.session.cwd()
  if (!sess && await hasCourse($, root)) await open($, root)
  if (sess?.course && !sess.course.setup.length) return { ok: false, reason: 'The course is still being written. Try again in a minute.' }
  if (sess?.build?.stage === 'planning') { sess.build.open = true; await refresh($); return { ok: true, planning: sess.build.title } }
  if (!sess) {
    const env = await probeEnvCached($)
    const device = await deviceOf($)
    sess = { root, os: env.os, segments: {}, state: replay([]), log: newLog(root, device), metrics: newLog(root, device, 'metrics'), welcome: false, env, vscode: vsCodeFor($, root) }
  }
  const suggestions = (Array.isArray(a.suggestions) ? a.suggestions : []).filter(x => typeof x?.title === 'string' && typeof x?.pitch === 'string').slice(0, 4)
  sess.build = { stage: 'pick', suggestions, open: true }
  await $.ui.open({ id: PANE, title: 'Build with me' })
  const idea = a.idea?.trim()
  if (idea) await planProject($, { title: idea.slice(0, 120), pitch: idea.slice(0, 300), ...(a.subject ? { subject: a.subject } : {}) })
  else await refresh($)
  return { ok: true, next: idea ? 'The project is being planned (about a minute). Say one short line; nothing else to do.' : 'The learner picks a project in the lesson view, or types their own. Say one short line; nothing else to do.' }
}

async function buildPress($: EngineInterface, p: Press) {
  const s = sess!
  const b = s.build!
  if ('action' in p && p.action === 'back') {
    if (b.stage === 'planning') b.open = false
    else s.build = undefined
    return refresh($)
  }
  if (b.stage !== 'pick') return
  const text = 'text' in p ? p.text.trim() : ''
  const pick = 'choose' in p ? b.suggestions[p.choose - 1] : text ? { title: text.slice(0, 120), pitch: text.slice(0, 300) } : undefined
  if (pick) await planProject($, pick)
}

async function planProject($: EngineInterface, pick: ProjectPick) {
  const s = sess!
  void metric($, { kind: 'build-pick', title: pick.title, own: !s.build?.suggestions.includes(pick) })
  // No course here yet: write one that leads to this project
  if (!s.course) { s.build = undefined; await generateCourse($, pick.subject ?? pick.title, s.root, undefined, pick); return }
  s.build = { ...s.build!, stage: 'planning', title: pick.title, open: true, note: undefined }
  await refresh($)
  await spawnAgent($, {
    subagentType: `${PLUGIN}:author`, model: AUTHOR_MODEL, description: 'Teach Me: plan a project to build together',
    prompt: projectTask(s.course, snapshot(await ctx($)), pick),
  }, async r => {
    if (!s.build) return
    if (r.deny) { s.build = { ...s.build, stage: 'pick', note: 'Planning could not start. Pick again.' }; return refresh($) }
    s.build.agent = r.agentId
  })
}

async function submitProject($: EngineInterface, input: { phase: unknown; segment: unknown; newSkills?: Course['skills'] }) {
  const s = sess
  if (!s?.course) return { ok: false, errors: ['no course in this folder'] }
  const phase = input.phase as Phase
  const errors = validateProjectPhase(phase, s.course, input.newSkills ?? [])
  // Fit the learner's level: once they have answers, a project may bring in one skill they have not started, not more
  const lv = level(await ctx($))
  const fresh = Array.isArray(phase?.skills) ? phase.skills.filter(k => lv.notStarted.includes(k) || (input.newSkills ?? []).some(n => n.id === k)) : []
  if (lv.answers && fresh.length > 1) errors.push(`phase.skills has ${fresh.length} skills the learner has not started (${fresh.join(', ')}): at most one, taught before its task. They can use: ${lv.canUse.join(', ') || 'nothing yet'}`)
  if (!errors.length && (input.segment as Segment)?.id !== phase.segments[0]) errors.push(`segment must be the first milestone, "${phase.segments[0]}"`)
  if (errors.length) return { ok: false, errors }
  const before = s.course
  s.course = { ...before, phases: withProject(before, s.state, { id: phase.id, title: phase.title, brief: phase.brief, project: phase.project, skills: phase.skills, segments: phase.segments }) }
  const r = await submitSegment($, { segment: input.segment, ...(input.newSkills ? { newSkills: input.newSkills } : {}) })
  if (!r.ok) { s.course = before; return r }
  void metric($, { kind: 'project', phase: phase.id, milestones: phase.segments.length })
  const stage = s.state.stage
  if ((stage === 'curriculum' || stage === 'recap') && (s.state.done || !s.state.pos)) {
    s.build = undefined
    await commit($, press(await ctx($), { action: 'start' }))
  } else if (s.build) {
    s.build = { ...s.build, stage: 'ready', title: phase.title, open: true }
    await refresh($)
  }
  return { ok: true, id: phase.id, next: `Milestone 1 is installed. The next milestones are asked for as the learner gets there; nothing else to do now.` }
}

async function submitCourse($: EngineInterface, input: { course: unknown }) {
  const s = sess
  if (!s?.course || s.course.setup.length) return { ok: false, errors: ['no course is being written in this folder'] }
  const c = input.course as Course
  const errors = validateCourse(c)
  for (const r of Array.isArray(c?.setup) ? c.setup : []) if (!SETUP_ADAPTERS.includes(r?.adapter)) errors.push(`setup ${r?.id}: adapter must be one of ${SETUP_ADAPTERS.join(', ')}`)
  if (Array.isArray(c?.setup) && c.setup.at(-1)?.adapter !== 'verify') errors.push('setup must end with the verify requirement')
  if (errors.length) return { ok: false, errors }
  s.course = { ...c, id: s.course.id, intake: GENERIC_INTAKE }
  await install($, s.root, s.course, [])
  const t = await $.clock.now()
  s.busy = undefined
  await commit($, { events: s.course.setup.filter(r => isTool(r.adapter)).map(r => ({
    ts: t, type: 'setup' as const, req: r.id, status: s.env?.tools[r.adapter] ? 'ok' as const : 'missing' as const, ...(s.env?.tools[r.adapter] ? { note: s.env.tools[r.adapter]! } : {}),
  })), effects: [] })
  void metric($, { kind: 'course', id: s.course.id, skills: s.course.skills.length })
  return { ok: true, next: `Now submit segment "${s.course.phases[0]?.segments[0]}" with submit_segment.` }
}

async function startCourse($: EngineInterface, subject: string, root: string, who: { background?: string; skipBasics?: boolean } = {}) {
  if (await hasCourse($, root)) {
    if (!sess) await open($, root)
    return { ok: true, resumed: true, course: sess?.course?.subject, screen: (await read($, view))?.kind }
  }
  if (sess?.root === root && sess.course && !sess.course.setup.length) return { ok: true, resumed: true, course: sess.course.subject, next: 'The course is being written; the learner answers the intake meanwhile.' }
  const lib = who.skipBasics ? undefined : LIBRARY.find(c => c.match.test(subject))
  if (!lib) return generateCourse($, subject, root, who.background)
  const { course, segments } = lib
  await install($, root, course, segments)
  await open($, root)
  const s = sess!
  const t = await $.clock.now()
  const env = s.env!
  const detected: LogEvent[] = [
    { ts: t, type: 'course', course: course.id },
    ...course.setup.filter(r => isTool(r.adapter)).map(r => ({
      ts: t, type: 'setup' as const, req: r.id, status: env.tools[r.adapter] ? 'ok' as const : 'missing' as const, ...(env.tools[r.adapter] ? { note: env.tools[r.adapter]! } : {}),
    })),
  ]
  await commit($, { events: detected, effects: [] })
  void metric($, { kind: 'start', envMs: env.ms })
  await $.ui.open({ id: PANE, title: course.subject })
  return { ok: true, course: course.subject, env: `${env.os}, ${env.shell}, ${env.editor}; ${Object.entries(env.tools).filter(([, v]) => v).map(([k]) => k).join(', ')}`, next: 'The learner answers 3 questions in the lesson view. Say one short line; nothing else to do.' }
}

export async function lessonRegister($: EngineInterface) {
  await $.tool.register({
    name: 'start_course', isDeferred: false,
    description: 'Teach Me: start or resume a course in this folder ("teach me <subject>"). The lesson view runs the course from then on; answer the learner\'s own questions briefly in chat.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'What the learner wants to learn, e.g. "Git"' },
        background: { type: 'string', description: 'What the learner said they already know, in their words, if they said it' },
        skipBasics: { type: 'boolean', description: 'true only if the learner said they already know the basics or asked to skip them' },
      },
      required: ['subject'],
    },
  })
  await $.tool.register({
    name: 'snapshot', isDeferred: false,
    description: 'Teach Me: where the learner is now (step, skills, recent mistakes). Read it before answering a learning question.',
    inputSchema: { type: 'object', properties: {} },
  })
  await $.tool.register({
    name: 'progress', isDeferred: false,
    description: 'Teach Me: the progress of the learner, from their answers (accuracy, first-try rate, hints, time, learning curve, strengths, weaknesses). Also opens the Progress screen in the lesson view and pane.',
    inputSchema: { type: 'object', properties: {} },
  })
  await $.tool.register({
    name: 'submit_segment',
    description: 'Teach Me author: submit a lesson segment (teachme.script/1). It is validated and every check is run before it is cached. Returns {ok} or {errors}.',
    inputSchema: { type: 'object', properties: { segment: { type: 'object' }, newSkills: { type: 'array', items: { type: 'object' } } }, required: ['segment'] },
  })
  await $.tool.register({
    name: 'build_with_me', isDeferred: false,
    description: 'Teach Me: build a project together with the learner ("build with me"). Pass 3 project suggestions that fit their course and level, or the idea they named. The lesson view shows the choice; the project becomes the next phase of their course, milestone by milestone.',
    inputSchema: {
      type: 'object',
      properties: {
        suggestions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, pitch: { type: 'string', description: 'One sentence: what it does and what they practise' }, subject: { type: 'string', description: 'Language or stack, e.g. "Rust"' } }, required: ['title', 'pitch'] } },
        idea: { type: 'string', description: 'The project the learner already named, in their words' },
        subject: { type: 'string', description: 'Language or stack for their idea, when there is no course in this folder' },
      },
    },
  })
  await $.tool.register({
    name: 'submit_project',
    description: 'Teach Me author: submit a build-with-me project as a phase (id, title, brief, project folder, skills, milestone ids) with its first milestone segment. Validated and checked; returns {ok} or {errors}.',
    inputSchema: { type: 'object', properties: { phase: { type: 'object' }, segment: { type: 'object' }, newSkills: { type: 'array', items: { type: 'object' } } }, required: ['phase', 'segment'] },
  })
  await $.tool.register({
    name: 'recheck_setup',
    description: 'Teach Me doctor: run the setup checks again in the engine, on the PATH it started with. Returns each item as ✓ or ✗ with its note.',
    inputSchema: { type: 'object', properties: {} },
  })
  await $.tool.register({
    name: 'submit_course',
    description: 'Teach Me author: submit a new course (teachme.course/1) for the subject the learner asked for. It is validated; returns {ok, next} or {errors}.',
    inputSchema: { type: 'object', properties: { course: { type: 'object' } }, required: ['course'] },
  })
  await $.agent.register({ name: 'author', description: 'Writes Teach Me courses and lesson segments for one learner.', prompt: AUTHOR_PROMPT, tools: [TOOL('submit_course'), TOOL('submit_segment'), TOOL('submit_project')], model: AUTHOR_MODEL })
    .catch(err => $.ui.log(`teachme: author agent: ${err}`, { to: 'debug' }))
  await $.agent.register({ name: 'relay', description: 'Teach Me: starts the author or the doctor.', prompt: 'Reply OK, nothing else.', tools: [], model: 'haiku' })
    .catch(err => $.ui.log(`teachme: relay agent: ${err}`, { to: 'debug' }))
  await $.agent.register({ name: 'doctor', description: 'Finds why Teach Me or one of its setup items fails on this machine and fixes it. The only agent allowed to repair Teach Me files in .teachme/.', prompt: DOCTOR_PROMPT, tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', TOOL('recheck_setup'), TOOL('snapshot')], model: 'sonnet' })
    .catch(err => $.ui.log(`teachme: doctor agent: ${err}`, { to: 'debug' }))
}

export async function lessonStarted($: EngineInterface, cwd: string) {
  if (!(await hasCourse($, cwd))) await migrateMvp($, cwd)
  if (await hasCourse($, cwd)) {
    await open($, cwd)
    void $.ui.open({ id: PANE, title: sess?.course?.subject ?? 'Teach Me' })
  }
  $.clock.every(2000, async () => { if (sess?.vscode) await tick($, sess.vscode) })
  // While the next lesson is written, redraw so the seconds count shows it is alive
  $.clock.every(5000, async () => { if (sess?.preparing) await refresh($) })
}

async function migrateMvp($: EngineInterface, root: string) {
  const names = ['COURSE.md', 'ROADMAP.md', 'PROGRESS.md', 'GLOSSARY.md'] as const
  const text = await Promise.all(names.map(n => $.fs.read(`${root}/${n}`).catch(() => undefined)))
  const [courseMd, roadmap, progress] = text
  if (courseMd === undefined || progress === undefined) return
  const now = await $.clock.now()
  const { course, events } = migrate({ course: courseMd, ...(roadmap !== undefined ? { roadmap } : {}), progress }, now)
  if (validateCourse(course).length) return
  for (const [i, n] of names.entries()) if (text[i] !== undefined) await $.fs.write(`${root}/${DIR}/legacy/${n}`, text[i]!)
  await install($, root, course, [])
  await open($, root)
  await commit($, { events, effects: [] })
  const s = sess!
  const phase = course.phases.find(p => !p.skills.every(id => ['demonstrated', 'mastered'].includes(skillState(s.state, id, now)))) ?? course.phases[0]!
  void metric($, { kind: 'migrated', skills: course.skills.length, events: events.length })
  await prepare($, '', phase.segments[0])
}

const LIVE = ['pending', 'running', 'waiting', 'idle']

export async function isDoctor($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return false
  const agent = await $.agent.list().then(all => all.find(a => a.id === agentId), () => undefined)
  return agent?.type === `${PLUGIN}:doctor` && LIVE.includes(agent.status)
}
const LEARNER_HISTORY = /\.teachme[\\/](log[\\/]|metrics)/
const BY_DOCTOR = ' The teachme-anything:doctor agent repairs broken Teach Me files.'

const writesTeachme = (command: string) =>
  /\.teachme[\\/]/.test(command) && /(>>?\s*['"]?[^\s'"]*\.teachme[\\/]|\brm\b|\bmv\b|\bsed\s+-i|\btee\b)/.test(command)

export function lessonGuard(tool: string, input: { file_path?: string; notebook_path?: string; command?: string }, isDoctor = false): string | undefined {
  const path = (input.file_path ?? input.notebook_path ?? '').replace(/\\/g, '/')
  const command = input.command ?? ''
  const isEdit = /^(Edit|Write|NotebookEdit)$/.test(tool)
  const touchesTeachme = isEdit ? /(^|\/)\.teachme\//.test(path) : tool === 'Bash' && writesTeachme(command)
  if (touchesTeachme && isDoctor && LEARNER_HISTORY.test(isEdit ? path : command)) return "The learner's history (.teachme/log/, metrics) is never changed, not even to repair it."
  if (touchesTeachme && !isDoctor) return isEdit ? `Teach Me state is written by the engine only: use its tools (snapshot, submit_segment).${BY_DOCTOR}` : `Teach Me state is written by the engine only.${BY_DOCTOR}`
  if (isEdit && sess && /(^|\/)practice\//.test(path)) return "That folder is the learner's practice work: the tutor never edits it."
  return undefined
}

export function lessonSection() {
  if (!sess?.course) return undefined
  return {
    id: `${PLUGIN}:lesson`, scope: 'session' as const,
    text: 'Teach Me course in this folder. The lesson view (engine) runs every step, answer and hint; never repeat its content. ' +
      'Answer the learner\'s own question in at most 3 short sentences, plain words, no headings or lists; their position is in <teachme-position> on their message. ' +
      'End by pointing them back to the step in the lesson view. ' +
      'Never edit .teachme/ or practice/.',
  }
}

export async function lessonTutor($: EngineInterface) {
  if (!sess?.course) return undefined
  await $.ui.open({ id: PANE, title: sess.course.subject })
  return { text: 'Lesson pane opened.' }
}

export async function lessonBandText($: EngineInterface): Promise<string | undefined> {
  if (!sess?.course || !(await read($, view))) return undefined
  const c = await ctx($)
  const at = current(c)
  const where = at ? ` · ${at.seg.title} ${at.index + 1}/${at.seg.steps.length}` : ` · ${c.state.stage}`
  return `Teach Me · ${sess.course.subject}${where}${sess.vscode?.isUp ? ' · VS Code ●' : sess.vscode?.isElsewhere ? ' · VS Code shows a newer Claude Code session' : ''}`
}

export const registerLesson: Register = on => {
  on('agent.offer', { agent: `${PLUGIN}:author` }, () => ({ isOffered: false }))
  on('agent.offer', { agent: `${PLUGIN}:relay` }, () => ({ isOffered: false }))

  on('tool.check', async ($, e, next) => OWN_TOOLS.has(e.tool) ? { decision: 'allow', reason: 'Teach Me engine tool' } : next(e))

  on('tool.call', { tool: 'mcp__teachme-anything__start_course' }, async ($, e) => {
    const a = e as unknown as { subject: string; background?: string; skipBasics?: boolean }
    return { result: JSON.stringify(await startCourse($, a.subject, await $.session.cwd(), a)) }
  })
  on('tool.call', { tool: 'mcp__teachme-anything__snapshot' }, async $ => ({ result: sess ? snapshot(await ctx($)) : 'No Teach Me course in this folder.' }))
  on('tool.call', { tool: 'mcp__teachme-anything__progress' }, async $ => {
    if (!sess?.course) return { result: 'No Teach Me course in this folder.' }
    sess.progress = true
    await refresh($)
    return { result: statsText(sess.course, stats(sess.course, sess.state, await $.clock.now())) }
  })
  on('tool.call', { tool: 'mcp__teachme-anything__submit_segment' }, async ($, e) => ({ result: JSON.stringify(await submitSegment($, e as never)) }))
  on('tool.call', { tool: 'mcp__teachme-anything__submit_course' }, async ($, e) => ({ result: JSON.stringify(await submitCourse($, e as never)) }))
  on('tool.call', { tool: 'mcp__teachme-anything__build_with_me' }, async ($, e) => ({ result: JSON.stringify(await buildWithMe($, e as never)) }))
  on('tool.call', { tool: 'mcp__teachme-anything__recheck_setup' }, async $ => ({ result: await recheck($) }))
  on('tool.call', { tool: 'mcp__teachme-anything__submit_project' }, async ($, e) => ({ result: JSON.stringify(await submitProject($, e as never)) }))

  // The turn that answers Ask: its text holds the prompt sent
  on('turn.start', async ($, e, next) => {
    const a = sess?.asking
    if (a && !a.turn && !e.agentId && e.text.includes(a.prompt.slice(0, 120))) a.turn = e.turnId
    return next(e)
  })

  // The author of the next segment ended without a valid submit_segment: say so and offer a retry
  on('turn.complete', async ($, e, next) => {
    const a = sess?.asking
    if (a?.turn && a.turn === e.turnId && !e.agentId) {
      a.answer = e.answer.trim() || 'The answer is in the chat.'
      await refresh($)
    }
    const relayed = e.agentId ? relays.get(e.agentId) : undefined
    if (relayed) {
      relays.delete(e.agentId!)
      await relayed().catch(err => $.ui.log(`teachme: relayed spawn failed: ${err}`, { to: 'debug' }))
      return next(e)
    }
    const s = sess
    if (s?.build?.stage === 'planning' && e.agentId && e.agentId === s.build.agent) {
      void metric($, { kind: 'project-failed', title: s.build.title })
      s.build = { ...s.build, stage: 'pick', open: true, note: 'Planning did not work this time. Pick again, or describe it another way.' }
      await refresh($)
    }
    // The doctor finished: check the setup again, so its fix shows as ✓ or the item stays ✗ with a reason
    if (s?.healAgent && e.agentId === s.healAgent) {
      s.healAgent = undefined
      await recheck($)
    }
    if (s?.preparing && e.agentId && e.agentId === s.prepAgent) {
      s.prepError ??= authorEndReason(e.answer)
      $.ui.log(`teachme: the author ended without segment ${s.preparing}: ${s.prepError}`, { to: 'debug' })
      void metric($, { kind: 'prepare-failed', seg: s.preparing, reason: s.prepError })
      s.preparing = undefined
      s.prepAgent = undefined
      await refresh($)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!sess?.course || !e.text || e.text.startsWith('<')) return next(e)
    if (sess.state.stage === 'lesson' && !sess.state.aside) {
      const at = current(await ctx($))
      await commit($, { events: [{ ts: await $.clock.now(), type: 'aside', on: true, ...(at ? { step: at.step.id } : {}) }], effects: [] })
    }
    const reply = sess.state.stage === 'lesson' ? '\nReply in at most 3 short sentences, no headings or lists; the lesson view keeps their place.' : ''
    return next({ ...e, text: `${e.text}\n\n<teachme-position>\n${snapshot(await ctx($))}${reply}\n</teachme-position>` })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Code } = ui
    const Input = 'Input' in ui ? ui.Input : undefined
    const sc = await read($, view)
    if (!sc) return <Text dimColor>Say "teach me &lt;subject&gt;" to start.</Text>
    const go = (p: Press) => () => { void dispatch($, p) }
    const tone = (t?: string) => t === 'right' ? 'success' : t === 'wrong' ? 'warning' : undefined
    const glyph = { ok: '✓', todo: '○', fail: '✗', run: '…', now: '●' } as const
    const line = (l: Line, key: string) => (
      <Box key={key} flexDirection="column">
        <Text color={l.mark === 'ok' ? 'success' : l.mark === 'fail' ? 'warning' : undefined}>{glyph[l.mark]} {l.text}</Text>
        {l.detail && <Text dimColor>  {l.detail}</Text>}
      </Box>
    )
    return (
      <Box flexDirection="column" gap="sm">
        {sc.progress && <Text dimColor>{sc.progress.label} {'▓'.repeat(Math.round(5 * sc.progress.done / Math.max(1, sc.progress.total)))}{'░'.repeat(5 - Math.round(5 * sc.progress.done / Math.max(1, sc.progress.total)))}</Text>}
        <Text bold>{sc.title}</Text>
        {sc.body && <Markdown text={sc.body} />}
        {sc.compare && <Markdown text={`${sc.compare.text}\n\n*Where it stops:* ${sc.compare.stops}`} />}
        {sc.code && <Box borderStyle="round" borderColor="subtle" paddingX={1}><Code source={sc.code.source} language={sc.code.lang} wrap="wrap" /></Box>}
        {sc.where && (
          <Box flexDirection="column">
            {sc.where.file && <Text dimColor>Edit {sc.where.dir}/{sc.where.file}</Text>}
            <Text dimColor>In a second terminal: cd {sc.where.dir}</Text>
          </Box>
        )}
        {sc.frame && (
          <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor="suggestion">
            <Text dimColor>Frame {sc.frame.i + 1} of {sc.frame.n}</Text>
            {sc.frame.state && <Code source={sc.frame.state} wrap="wrap" />}
            {sc.frame.code && <Code source={sc.frame.code} wrap="wrap" />}
            <Text>{sc.frame.note}</Text>
          </Box>
        )}
        {sc.output !== undefined && (
          <Box flexDirection="column">
            <Text dimColor>Output</Text>
            <Box flexDirection="column" paddingX={1}>
              {sc.output.split('\n').map((l, i) => <Text key={`out-${i}`} color={OUT_ERR.test(l) ? 'error' : OUT_WARN.test(l) ? 'warning' : undefined}>{l || ' '}</Text>)}
            </Box>
          </Box>
        )}
        {sc.table && (() => {
          const t = sc.table
          const w = t.columns.map((c, k) => Math.max(c.length, ...t.rows.map(r => r.cells[k]!.length + (r.at === k ? 1 : 0))))
          return (
            <Box flexDirection="column">
              <Text dimColor>{t.columns.map((c, k) => c.padEnd(w[k]!)).join('  ')}</Text>
              {t.rows.map((r, i) => (
                <Text key={`row-${i}`} color={r.mark === 'right' ? 'success' : r.mark === 'wrong' ? 'warning' : undefined}>
                  {r.cells.map((c, k) => (r.at === k ? `▸${c}` : c).padEnd(w[k]!)).join('  ')}{r.mark === 'right' ? '  ✓' : r.mark === 'wrong' ? '  ✗' : ''}
                </Text>
              ))}
            </Box>
          )
        })()}
        {sc.built && (
          <Box flexDirection="column">
            {sc.built.length === 0 && <Text dimColor>Press the lines in order.</Text>}
            {sc.built.map((b, i) => <Text key={`built-${i}`} color={b.mark === 'right' ? 'success' : b.mark === 'wrong' ? 'warning' : undefined}>{`${i + 1}. ${b.text}`}{b.mark === 'right' ? '  ✓' : b.mark === 'wrong' ? '  ✗' : ''}</Text>)}
          </Box>
        )}
        {sc.lines?.map((l, i) => line(l, `line-${i}`))}
        {sc.tiles && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {sc.tiles.map(t => <Text key={`tile-${t.label}`}><Text bold>{t.value}</Text> <Text dimColor>{t.label}</Text></Text>)}
          </Box>
        )}
        {sc.chart && (
          <Box flexDirection="column">
            <Text color="suggestion">{sc.chart.points.map(v => SPARK[Math.round(v * (SPARK.length - 1))]).join('')}</Text>
            <Text dimColor>{sc.chart.label} · first {Math.round(100 * sc.chart.points[0]!)}%, now {Math.round(100 * sc.chart.points.at(-1)!)}%</Text>
          </Box>
        )}
        {sc.groups?.map(g => (
          <Box key={`group-${g.title}`} flexDirection="column">
            <Text bold>{g.title}</Text>
            {g.lines.map((l, i) => line(l, `${g.title}-${i}`))}
          </Box>
        ))}
        {sc.choices?.map(ch => (
          <Box key={`choice-${ch.n}`} flexDirection="column">
            {ch.used
              ? <Text dimColor>✓ {ch.n}  {ch.text}</Text>
              : ch.mark || (sc.result && sc.result.tone !== 'info')
              ? <Text color={ch.mark === 'right' || ch.mark === 'key' ? 'success' : ch.mark === 'wrong' ? 'warning' : undefined} dimColor={!ch.mark}>{ch.mark === 'right' ? '✓' : ch.mark === 'wrong' ? '✗' : ch.mark === 'key' ? '→' : ' '} {ch.n}  {ch.text}</Text>
              : <Button key={`choose-${ch.n}`} hotkey={String(ch.n)} plain onPress={go({ choose: ch.n })}>{ch.text}</Button>}
            {ch.code && ch.code.trim() !== ch.text.trim() && <Box paddingX={2}><Code source={ch.code} wrap="wrap" /></Box>}
            {ch.mark && ch.why && <Text dimColor>    {ch.why}</Text>}
          </Box>
        ))}
        {sc.input && Input && <Input key="intake-text" placeholder={sc.input.placeholder} submitLabel="send" onSubmit={(v: string) => { if (v.trim()) void dispatch($, { text: v }) }} />}
        {sc.hint && <Text color="suggestion">Hint {sc.hint.level}: {sc.hint.text}</Text>}
        {sc.result && sc.result.tone === 'info' && sc.kind === 'step' ? <Markdown text={sc.result.text} /> : sc.result && <Text color={tone(sc.result.tone)} italic={sc.result.tone === 'wait'}>{sc.result.tone === 'right' ? '✓ ' : sc.result.tone === 'wrong' ? '✗ ' : ''}{sc.result.text}</Text>}
        {(sc.actions.length > 0 || e.surface === 'terminal') && (
          <Box flexDirection="row" flexWrap="wrap" gap="sm">
            {sc.actions.map(a => (
              <Button key={`act-${a.id}`} variant={a.primary ? 'primary' : 'secondary'} {...(a.key && /^[a-z]$/.test(a.key) ? { hotkey: a.key } : {})} onPress={go({ action: a.id })}>{a.label}</Button>
            ))}
            {e.surface === 'terminal' && <Button key="open-vscode" variant="secondary" hotkey="v" onPress={() => { void openInVsCode($) }}>Open in VS Code</Button>}
          </Box>
        )}
        {sc.more && <Text dimColor>{sc.more}</Text>}
      </Box>
    )
  })
}

export const _session = () => sess
export const _reset = () => { sess = undefined; envCache = undefined }
export { setupDone, DIR }
