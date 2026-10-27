import type { Course, Segment } from './types'

const KINDS = ['concept', 'compare', 'worked', 'predict', 'mcq', 'reorder', 'spot-bug', 'trace', 'stepper', 'terminal', 'code', 'review', 'stage']
const CLASSES = ['slip', 'misconception', 'prereq', 'environment', 'misread']
const SKILL_TYPES = ['code', 'tool', 'data', 'config', 'ops', 'concept', 'design']
const RUNNABLE = ['python', 'sql', 'javascript', 'js']
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
    if (s?.remedy && (!s.drill || (tags && !tags.has(s.remedy)))) err.push(`${at}: remedy must be a known misconception tag, on a drill step`)
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
