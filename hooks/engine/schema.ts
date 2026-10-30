import type { Course, Phase, Segment } from './types'

const KINDS = ['concept', 'compare', 'worked', 'predict', 'mcq', 'reorder', 'spot-bug', 'trace', 'stepper', 'terminal', 'code', 'review', 'stage']
const CLASSES = ['slip', 'misconception', 'prereq', 'environment', 'misread']
const SKILL_TYPES = ['code', 'tool', 'data', 'config', 'ops', 'concept', 'design']
const RUNNABLE = ['python', 'sql', 'javascript', 'js']
const TEACHING = ['concept', 'compare', 'worked', 'stepper']
const QUESTIONS = ['predict', 'mcq', 'reorder', 'spot-bug', 'trace']
const MAX_BODY_WORDS = 80
const MAX_CODE_LINES = 12

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isArr = Array.isArray
const outside = (p: string) => /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/.test(p)
const words = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('|')).join(' ').split(/\s+/).filter(Boolean).length

export function validateCourse(c: any): string[] {
  const err: string[] = []
  if (c?.format !== 'teachme.course/1') return ['format must be "teachme.course/1"']
  for (const f of ['id', 'subject', 'goal']) if (!isStr(c[f])) err.push(`${f} is required`)
  if (!isArr(c.intake)) err.push('intake must be a list')
  else c.intake.forEach((q: any, i: number) => {
    if (!isStr(q?.id) || !isStr(q?.q) || !isArr(q?.options) || q.options.length < 2 || q.options.length > 8) err.push(`intake[${i}]: id, q and 2–8 options`)
  })
  const ids = new Set<string>()
  if (!isArr(c.skills) || !c.skills.length) err.push('skills must be a non-empty list')
  else c.skills.forEach((k: any, i: number) => {
    if (!isStr(k?.id) || !isStr(k?.title)) err.push(`skills[${i}]: id and title`)
    if (!SKILL_TYPES.includes(k?.type)) err.push(`skills[${i}].type must be one of ${SKILL_TYPES.join(', ')}`)
    if (!isArr(k?.prereqs) || !isArr(k?.misconceptions)) err.push(`skills[${i}]: prereqs and misconceptions lists`)
    ids.add(k?.id)
  })
  for (const k of isArr(c.skills) ? c.skills : []) for (const p of isArr(k?.prereqs) ? k.prereqs : []) if (!ids.has(p)) err.push(`skill ${k.id}: unknown prereq ${p}`)
  if (!isArr(c.phases) || !c.phases.length) err.push('phases must be a non-empty list')
  else c.phases.forEach((p: any, i: number) => {
    if (!isStr(p?.id) || !isStr(p?.title) || !isArr(p?.skills) || !isArr(p?.segments)) err.push(`phases[${i}]: id, title, skills, segments`)
    for (const s of isArr(p?.skills) ? p.skills : []) if (!ids.has(s)) err.push(`phases[${i}]: unknown skill ${s}`)
  })
  if (!isArr(c.setup)) err.push('setup must be a list')
  else c.setup.forEach((r: any, i: number) => {
    if (!isStr(r?.id) || !isStr(r?.title) || !isStr(r?.adapter) || !['local', 'container'].includes(r?.where)) err.push(`setup[${i}]: id, title, adapter, where`)
  })
  return err
}

// How a segment teaches, checked only when an author submits one, so lessons written before these rules still load:
// teach a skill before testing it, test it before the next idea starts, and from the second segment on, use earlier skills in a task.
export function untaught(g: Segment, before: readonly Segment[] = []): string[] {
  const err: string[] = []
  const earlier = before.filter(b => b.id !== g.id)
  const taught = new Set(earlier.flatMap(b => b.steps.filter(x => TEACHING.includes(x.kind) && x.skill).map(x => x.skill!)))
  let open: string | undefined
  g.steps.forEach((s, i) => {
    if (!s.skill || s.drill) return
    const at = `steps[${i}] (${s.id})`
    if (TEACHING.includes(s.kind)) {
      if (open && open !== s.skill) err.push(`${at}: test skill ${open} with a question or task before teaching ${s.skill}`)
      open = s.skill
      taught.add(s.skill)
    } else if (s.choices || s.check) {
      if (!taught.has(s.skill)) err.push(`${at}: skill ${s.skill} is tested before a concept, compare, worked or stepper step with that skill explains it (why, feedback and more do not count)`)
      taught.add(s.skill)
      if (open === s.skill) open = undefined
    }
  })
  if (open) err.push(`skill ${open} is taught last but never tested after it`)
  const old = new Set(earlier.filter(b => !b.steps.every(x => x.drill)).flatMap(b => b.skills))
  const graded = g.steps.filter(s => !s.drill && (s.choices || s.check))
  if (old.size && graded.length && !graded.some(s => s.uses?.some(u => old.has(u)))) err.push(`no question or task uses an earlier skill: name the earlier skills it combines in "uses" (one of ${[...old].join(', ')})`)
  return err
}

// A build-with-me phase as the author submits it
const MAX_SECTION_WORDS = 300
const MAX_EXAMPLE_LINES = 30

// A reading for Explore: detailed sections, each with its sources; runnable examples say exactly what they print
export function validateReading(r: any): string[] {
  if (r?.format !== 'teachme.read/1') return ['format must be "teachme.read/1"']
  const err: string[] = []
  for (const f of ['id', 'topic']) if (!isStr(r[f])) err.push(`${f} is required`)
  if (isStr(r.id) && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(r.id)) err.push('id: lowercase letters, digits and dashes')
  if (!isArr(r.related)) err.push('related must be a list of topics')
  if (!isArr(r.sections) || r.sections.length < 3 || r.sections.length > 12) return [...err, 'sections: 3 to 12']
  r.sections.forEach((x: any, i: number) => {
    const at = `sections[${i}]`
    if (!isStr(x?.title) || !isStr(x?.body)) { err.push(`${at}: title and body`); return }
    if (words(x.body) > MAX_SECTION_WORDS) err.push(`${at}: body over ${MAX_SECTION_WORDS} words; split it into two sections`)
    if (!isArr(x.sources) || !x.sources.length) err.push(`${at}: name at least one source`)
    for (const src of isArr(x.sources) ? x.sources : []) if (!isStr(src?.title) || !/^https:\/\/\S+$/.test(src?.url ?? '')) err.push(`${at}: a source is {title, url} with an https url`)
    if (x.code) {
      if (!isStr(x.code.lang) || !isStr(x.code.source)) err.push(`${at}.code: lang and source`)
      else if (x.code.source.split('\n').length > MAX_EXAMPLE_LINES) err.push(`${at}.code: over ${MAX_EXAMPLE_LINES} lines`)
      if (RUNNABLE.includes(x.code.lang) && !x.code.run) err.push(`${at}.code: a ${x.code.lang} example needs run {file, argv, out}`)
      if (x.code.run && (!isStr(x.code.run.file) || !isArr(x.code.run.argv) || typeof x.code.run.out !== 'string' || outside(x.code.run.file))) err.push(`${at}.code.run: file (relative), argv and out`)
    }
  })
  return err
}

// A re-plan replaces only what comes after the phase of the segment being written; projects stay
export function replanErrors(course: Course, phases: any, segId: string): string[] {
  if (!isArr(phases)) return ['phases must be the whole new list of phases']
  const at = course.phases.findIndex(p => p.segments.includes(segId))
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const err = course.phases.slice(0, at + 1).flatMap((p, i) => same(phases[i], p) ? [] : [`phases[${i}] must stay exactly as it is ("${p.id}"): only phases after it may change`])
  for (const p of course.phases.filter(x => x.project)) if (!phases.some((q: unknown) => same(q, p))) err.push(`the project phase "${p.id}" must stay`)
  const ids = phases.flatMap((p: any) => isArr(p?.segments) ? p.segments : [])
  for (const id of new Set(ids.filter((id: string, i: number) => ids.indexOf(id) !== i))) err.push(`segment id "${id}" is in more than one phase`)
  return [...err, ...validateCourse({ ...course, phases }).map(e => `phases: ${e}`)]
}

export function validateProjectPhase(p: any, course: Course, newSkills: readonly any[] = []): string[] {
  const err: string[] = []
  const known = new Set([...course.skills, ...newSkills].map(k => k?.id))
  const used = new Set(course.phases.flatMap(x => [x.id, ...x.segments]))
  if (!isStr(p?.id) || !isStr(p?.title) || !isStr(p?.brief)) err.push('phase: id, title and brief (one sentence: what the learner builds)')
  if (used.has(p?.id)) err.push(`phase id ${p?.id} is taken`)
  if (!isArr(p?.skills) || !p.skills.every((k: unknown) => known.has(k))) err.push('phase.skills lists known skill ids (add new ones with newSkills)')
  if (!isArr(p?.segments) || p.segments.length < 2 || p.segments.length > 8 || new Set(p.segments).size !== p.segments.length || p.segments.some((x: unknown) => !isStr(x) || used.has(x))) err.push('phase.segments: 2 to 8 new, unique milestone ids')
  if (!isStr(p?.project) || !/^practice\/[\w.-]+$/.test(p.project)) err.push('phase.project is the project folder, "practice/<name>"')
  return err
}

// A milestone works in the project folder and leaves the learner's files to the learner
export function milestoneErrors(g: Segment, phase: Phase, before: readonly Segment[]): string[] {
  const err: string[] = []
  if (g.practice?.dir !== phase.project) err.push(`practice.dir must be the project folder ${phase.project}`)
  const mine = new Set([...before.filter(b => phase.segments.includes(b.id) && b.id !== g.id), g].flatMap(b => b.steps.map(x => x.open).filter((x): x is string => !!x)))
  for (const c of g.practice?.adds ?? []) if (c[0] === '@write' && mine.has(c[1]!)) err.push(`practice.adds writes ${c[1]}, a file the learner writes`)
  if (!g.steps.some(x => !x.drill && x.kind === 'code' && x.open && x.check)) err.push('a milestone needs a code task with "open" and a check: the part the learner writes')
  return err
}

export function validateSegment(g: any, course?: Course): string[] {
  const err: string[] = []
  if (g?.format !== 'teachme.script/1') return ['format must be "teachme.script/1"']
  if (!isStr(g.id) || !isStr(g.title) || !isArr(g.skills)) err.push('id, title and skills are required')
  if (!isArr(g.steps) || !g.steps.length) return [...err, 'steps must be a non-empty list']
  const known = course && new Set(course.skills.map(k => k.id))
  const tags = course && new Set(course.skills.flatMap(k => k.misconceptions.map(m => m.tag)))
  const stepIds = new Set(g.steps.map((s: any) => s?.id))
  if (stepIds.size !== g.steps.length) err.push('step ids must be unique')
  if (g.practice && (!isStr(g.practice.adapter) || !isStr(g.practice.dir) || !isArr(g.practice.scaffold))) err.push('practice: adapter, dir, scaffold')
  if (g.practice && outside(g.practice.dir)) err.push('practice.dir must be a relative path inside the course folder')
  if (g.practice?.adds !== undefined && (!isArr(g.practice.adds) || !g.practice.adds.every((c: unknown) => isArr(c) && c.length > 0))) err.push('practice.adds is a list of commands, like scaffold')
  for (const id of isArr(g.skills) ? g.skills : []) {
    if (!g.steps.some((s: any) => s?.skill === id && !s.drill && (s.choices || s.check))) err.push(`skill ${id} has no graded step in this segment`)
  }
  g.steps.forEach((s: any, i: number) => {
    const at = `steps[${i}] (${s?.id})`
    if (!isStr(s?.id) || !isStr(s?.title) || !isStr(s?.body)) err.push(`${at}: id, title, body`)
    if (!KINDS.includes(s?.kind)) err.push(`${at}: unknown kind ${s?.kind}`)
    if (![1, 2, 3].includes(s?.difficulty)) err.push(`${at}: difficulty 1–3`)
    if (isStr(s?.body) && words(s.body) > MAX_BODY_WORDS) err.push(`${at}: body over ${MAX_BODY_WORDS} words (put the rest in "more")`)
    if (s?.code && (!isStr(s.code.source) || s.code.source.split('\n').length > MAX_CODE_LINES)) err.push(`${at}: code over ${MAX_CODE_LINES} lines`)
    if (s?.code?.run && (!isStr(s.code.run.file) || outside(s.code.run.file) || !isArr(s.code.run.argv) || !s.code.run.argv.length || typeof s.code.run.out !== 'string')) err.push(`${at}: code.run needs a relative file, argv and the expected out`)
    if (s?.code && RUNNABLE.includes(s.code.lang) && !s.code.run) err.push(`${at}: a ${s.code.lang} example needs code.run, so it is run before it is shown`)
    if (s?.open !== undefined && (!isStr(s.open) || outside(s.open) || !g.practice)) err.push(`${at}: open names a file inside the practice folder`)
    if (s?.kind === 'stepper' && (!isArr(s.frames) || s.frames.length < 2 || !s.frames.every((x: any) => isStr(x?.note)))) err.push(`${at}: a stepper needs two or more frames, each with a note`)
    if (s?.compare && (!isStr(s.compare.with) || !isStr(s.compare.text) || !isStr(s.compare.stops))) err.push(`${at}: compare needs with, text and stops (where the comparison stops)`)
    if (known && s?.skill && !known.has(s.skill)) err.push(`${at}: unknown skill ${s.skill}`)
    if (s?.uses !== undefined && (!isArr(s.uses) || !s.uses.every((u: unknown) => isStr(u) && (!known || known.has(u))))) err.push(`${at}: uses lists known skill ids`)
    if (s?.remedy && (!s.drill || (tags && !tags.has(s.remedy)))) err.push(`${at}: remedy must be a known misconception tag, on a drill step`)
    // A question with nothing to pick shows its answer (a run output) and can never be answered (#15)
    if (QUESTIONS.includes(s?.kind) && !s.choices) err.push(`${at}: a ${s.kind} step needs choices and a key (0-based indexes into choices)`)
    if (s?.choices) {
      if (!isArr(s.choices) || s.choices.length < 2 || s.choices.length > 8) err.push(`${at}: 2–8 choices`)
      else s.choices.forEach((ch: any, j: number) => { if (!isStr(ch?.text) || !isStr(ch?.why)) err.push(`${at}: choice ${j + 1} needs text and why`) })
      const n = isArr(s.choices) ? s.choices.length : 0
      const inRange = isArr(s.key) && s.key.every((k: unknown) => Number.isInteger(k) && (k as number) >= 0 && (k as number) < n)
      if (s.kind === 'reorder') {
        if (!inRange || s.key.length !== n || new Set(s.key).size !== n) err.push(`${at}: a reorder key lists every choice once, in the right order`)
      } else if (s.kind === 'trace') {
        const blanks = isArr(s.trace?.rows) ? s.trace.rows.flat().filter((x: unknown) => x === '?').length : 0
        if (!isArr(s.trace?.columns) || !isArr(s.trace?.rows) || !s.trace.rows.every((r: unknown) => isArr(r) && r.length === s.trace.columns.length)) err.push(`${at}: trace needs columns and rows of the same width`)
        if (!inRange || !blanks || s.key.length !== blanks) err.push(`${at}: a trace key has one choice per "?" cell`)
      } else if (!inRange || s.key.length !== 1) err.push(`${at}: key must name exactly one choice (0-based)`)
    }
    if (s?.check) {
      if (!isArr(s.check.probes) || !s.check.probes.length) err.push(`${at}: check needs probes`)
      else s.check.probes.forEach((p: any) => { if (!isStr(p?.id) || !isArr(p?.argv) || !p.argv.length || !p.expect) err.push(`${at}: probe ${p?.id}: id, argv, expect`) })
      if (!isArr(s.check.reference) || !s.check.reference.length) err.push(`${at}: check needs reference commands (the verifier runs them)`)
      if (!g.practice) err.push(`${at}: a check needs the segment's practice environment`)
    }
    if (s?.hints && (!isArr(s.hints) || s.hints.length !== 3 || !s.hints.every(isStr))) err.push(`${at}: hints are three levels`)
    for (const w of isArr(s?.wrong) ? s.wrong : []) {
      if (!CLASSES.includes(w?.class) || !isStr(w?.feedback) || !w?.match) err.push(`${at}: wrong entries need match, class, feedback`)
      if (tags && w?.tag && !tags.has(w.tag)) err.push(`${at}: unknown misconception tag ${w.tag}`)
      if (w?.branch && !stepIds.has(w.branch)) err.push(`${at}: branch to unknown step ${w.branch}`)
      if (w?.match?.probe && !s.check?.probes?.some((p: any) => p.id === w.match.probe)) err.push(`${at}: wrong matches unknown probe ${w.match.probe}`)
    }
  })
  return err
}
