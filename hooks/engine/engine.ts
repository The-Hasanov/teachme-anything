import { RETENTION, dueAt, ratingOf, retrievability, review } from './fsrs'
import { classify, skillState } from './mastery'
import { WINDOW, pct, stats } from './stats'
import type { Action, Build, Course, Dashboard, Effect, LearnerState, LessonStatus, LogEvent, MistakeClass, Phase, Press, Screen, Segment, Step, WarmItem, Weakness } from './types'

export type Ctx = {
  state: LearnerState
  course?: Course
  segments: Record<string, Segment>
  now: number
  welcome?: boolean
  busy?: string
  progress?: boolean
  preparing?: boolean
  prepSince?: number
  prepError?: string
  build?: Build
  // Ask on this step: the agent's explanation once its turn ended, until then the question being answered
  asked?: { question?: string; answer?: string }
}

export type Out = { events: LogEvent[]; effects: Effect[] }

const NONE: Out = { events: [], effects: [] }
const DAY = 86_400_000
const PREPARE_AHEAD = 3
const MAX_DRILLS = 2
const WARM_ITEMS = 3
const QUESTION_KINDS = new Set(['predict', 'mcq', 'reorder', 'spot-bug', 'trace'])
const TASK_KINDS = new Set(['terminal', 'code', 'stage', 'review'])

export const initial = (): LearnerState => ({
  stage: 'intake', intake: {}, setup: {}, tries: {}, hints: {}, result: {}, solved: {}, idk: {}, gated: {}, added: {},
  evidence: [], mistakes: [], aside: false, asked: {}, migrated: [], notes: [], draft: {}, frame: {}, cards: {}, weak: {}, drills: {},
})

type Outcome = { ts: number; step: string; ok: boolean; skill?: string; hints: number; cls?: MistakeClass; tag?: string; prereq?: string; remedy?: string; review?: string; uses?: string[] }

function learn(s: LearnerState, o: Outcome): Pick<LearnerState, 'cards' | 'weak'> {
  const cards = { ...s.cards }
  const weak = { ...s.weak }
  if (o.skill) cards[`skill:${o.skill}`] = review(cards[`skill:${o.skill}`], ratingOf(o.ok, o.hints), o.ts)
  // Using earlier skills right inside a new task counts as a review of them; a miss is put on the new skill only
  if (o.ok) for (const u of o.uses ?? []) if (u !== o.skill) cards[`skill:${u}`] = review(cards[`skill:${u}`], ratingOf(true, o.hints), o.ts)
  const open = (key: string, skill: string | undefined, tag: string | undefined, cls: MistakeClass) => {
    const w = weak[key]
    weak[key] = { key, skill, tag, cls, count: (w?.count ?? 0) + 1, status: 'open', steps: [...new Set([...(w?.steps ?? []), o.step])], used: w?.used ?? [], last: o.ts }
    cards[`w:${key}`] = review(cards[`w:${key}`], 1, o.ts)
  }
  if (!o.ok && o.cls && o.cls !== 'environment' && o.cls !== 'slip') {
    open(o.tag ?? `skill:${o.skill}`, o.skill, o.tag, o.cls)
    if (o.prereq) open(`skill:${o.prereq}`, o.prereq, undefined, 'prereq')
  }
  if (o.ok) {
    for (const w of Object.values(weak)) {
      const isRecheck = o.review === w.key
      const fixesIt = w.status === 'open' && (o.remedy === w.tag || w.steps.includes(o.step))
      if (!isRecheck && !fixesIt) continue
      const card = review(cards[`w:${w.key}`], ratingOf(true, o.hints), o.ts)
      cards[`w:${w.key}`] = card
      weak[w.key] = isRecheck && w.status === 'recheck' && o.hints === 0 && o.ts >= (w.due ?? 0)
        ? { ...w, status: 'resolved', last: o.ts }
        : { ...w, status: 'recheck', due: Math.max(o.ts + DAY, dueAt(card)), last: o.ts }
    }
  }
  return { cards, weak }
}

function forget(s: LearnerState, e: Extract<LogEvent, { type: 'reset' }>): LearnerState {
  const steps = new Set(e.steps)
  const segs = new Set(e.segs)
  const skills = new Set(e.skills)
  const without = <T>(r: Record<string, T>, drop: (key: string, value: T) => boolean) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !drop(k, v)))
  const isStep = (k: string) => steps.has(k.replace(/^warm\d+:/, ''))
  const isGone = (w: Weakness) => skills.has(w.skill ?? '') || (w.steps.length > 0 && w.steps.every(x => steps.has(x)))
  const weak = without(s.weak, (_, w) => isGone(w))
  return {
    ...s,
    ...(e.rewind ? { pos: undefined, done: e.before } : {}),
    warm: undefined, aside: false,
    tries: without(s.tries, isStep), hints: without(s.hints, isStep), result: without(s.result, isStep), solved: without(s.solved, isStep),
    idk: without(s.idk, isStep), asked: without(s.asked, isStep), drills: without(s.drills, isStep), draft: without(s.draft, isStep), frame: without(s.frame, isStep),
    gated: without(s.gated, k => segs.has(k)), added: without(s.added, k => segs.has(k)),
    cards: without(s.cards, k => (k.startsWith('skill:') && skills.has(k.slice(6))) || (k.startsWith('w:') && !weak[k.slice(2)])),
    weak,
    evidence: s.evidence.filter(x => !steps.has(x.step)),
    mistakes: s.mistakes.filter(x => !steps.has(x.step)),
    migrated: s.migrated.filter(x => !skills.has(x.skill)),
  }
}

export function apply(s: LearnerState, e: LogEvent): LearnerState {
  const tries = (step: string) => ({ ...s.tries, [step]: (s.tries[step] ?? 0) + 1 })
  switch (e.type) {
    case 'course': return { ...s, course: e.course, stage: 'intake' }
    case 'intake': return { ...s, intake: { ...s.intake, [e.q]: e.a } }
    case 'stage': return { ...s, stage: e.stage, ...(e.stage === 'recap' && s.pos ? { done: s.pos.back?.seg ?? s.pos.seg } : {}) }
    case 'setup': return { ...s, setup: { ...s.setup, [e.req]: { status: e.status, note: e.note } } }
    case 'enter': {
      const back = typeof e.back === 'number' ? { seg: e.seg, step: e.back } : e.back
      const weak = e.drill && s.weak[e.drill] ? { ...s.weak, [e.drill]: { ...s.weak[e.drill]!, used: [...s.weak[e.drill]!.used, `${e.seg}/${e.step}`] } } : s.weak
      const drills = e.from ? { ...s.drills, [e.from]: (s.drills[e.from] ?? 0) + 1 } : s.drills
      return { ...s, pos: { seg: e.seg, step: e.step, ...(back ? { back } : {}) }, aside: false, weak, drills, since: e.ts, done: undefined }
    }
    case 'warm': return {
      ...s, since: e.ts, gated: e.gate ? { ...s.gated, [e.gate]: true } : s.gated,
      warm: e.items.length ? { items: e.items, i: 0, n: (s.warm?.n ?? 0) + 1, ...(e.gate ? { gate: e.gate } : {}) } : s.warm && { ...s.warm, items: [], i: 0 },
    }
    case 'warm-next': return { ...s, since: e.ts, warm: s.warm && s.warm.i + 1 < s.warm.items.length ? { ...s.warm, i: s.warm.i + 1 } : s.warm && { ...s.warm, items: [], i: 0 } }
    case 'skip': return s
    case 'added': return { ...s, added: { ...s.added, [e.seg]: true } }
    case 'dontknow': return {
      ...s, ...(e.skill ? learn(s, { ts: e.ts, step: e.step, ok: false, skill: e.skill, hints: 0, cls: 'prereq' }) : {}),
      idk: { ...s.idk, [e.step]: e.skill ?? '' }, since: e.ts,
    }
    case 'aside': return { ...s, aside: e.on, asked: e.on && e.step ? { ...s.asked, [e.step]: true } : s.asked }
    case 'hint': return { ...s, hints: { ...s.hints, [e.step]: e.level } }
    case 'pick': return { ...s, draft: { ...s.draft, [e.step]: e.picked } }
    case 'frame': return { ...s, frame: { ...s.frame, [e.step]: e.i } }
    case 'migrated-note': {
      const key = e.skill && `skill:${e.skill}`
      const weak = key && !s.weak[key] ? { ...s.weak, [key]: { key, skill: e.skill, cls: 'misconception' as const, count: 1, status: 'open' as const, steps: [], used: [], last: e.ts } } : s.weak
      return { ...s, notes: [...s.notes, e.text], weak }
    }
    case 'migrated': return { ...s, migrated: [...s.migrated, { skill: e.skill, state: e.state, evidence: e.evidence, date: e.date }] }
    case 'reset': return forget(s, e)
    case 'answer': {
      const ok = e.verdict === 'right'
      const rk = e.rk ?? e.step
      return {
        ...s,
        ...learn(s, { ts: e.ts, step: e.step, ok, skill: e.skill, hints: e.hints, cls: e.class, tag: e.tag, prereq: e.prereq, remedy: e.remedy, review: e.review, uses: e.uses }),
        tries: tries(rk),
        result: { ...s.result, [rk]: { tone: ok ? 'right' : 'wrong', text: e.feedback, picked: e.picked, branch: e.branch } },
        solved: ok ? { ...s.solved, [rk]: true } : s.solved,
        evidence: e.skill ? [...s.evidence, evidenceOf(e, ok, s.since)] : s.evidence,
        since: e.ts,
        mistakes: ok || !e.class ? s.mistakes : [...s.mistakes, { ts: e.ts, step: e.step, skill: e.skill, class: e.class, tag: e.tag }],
      }
    }
    case 'check': {
      const result = e.ok
        ? { tone: 'right' as const, text: e.feedback ?? 'Done.' }
        : e.pending
          ? { tone: 'wait' as const, text: e.feedback ? `Looking at your answer… ${e.feedback}` : 'Looking at your answer…' }
          : { tone: 'wrong' as const, text: e.feedback ?? 'Not yet.', branch: e.branch }
      const known = e.ok || !e.pending
      return {
        ...s,
        ...(known ? learn(s, { ts: e.ts, step: e.step, ok: e.ok, skill: e.skill, hints: e.hints, cls: e.class, tag: e.tag, prereq: e.prereq, remedy: e.remedy, review: e.review, uses: e.uses }) : {}),
        tries: tries(e.step),
        result: { ...s.result, [e.step]: result },
        solved: e.ok ? { ...s.solved, [e.step]: true } : s.solved,
        evidence: e.skill ? [...s.evidence, evidenceOf(e, e.ok, s.since)] : s.evidence,
        since: e.ts,
        mistakes: e.ok || !e.class ? s.mistakes : [...s.mistakes, { ts: e.ts, step: e.step, skill: e.skill, class: e.class, tag: e.tag }],
      }
    }
    case 'feedback':
      return {
        ...s,
        ...learn(s, { ts: e.ts, step: e.step, ok: false, skill: e.skill, hints: 0, cls: e.class, tag: e.tag }),
        result: { ...s.result, [e.step]: { tone: 'wrong', text: e.feedback } },
        mistakes: [...s.mistakes, { ts: e.ts, step: e.step, skill: e.skill, class: e.class, tag: e.tag }],
      }
  }
}

const AWAY_MS = 30 * 60_000
const evidenceOf = (e: { ts: number; step: string; skill?: string; difficulty: number; unseen?: boolean; hints: number }, ok: boolean, since?: number) => {
  const secs = since !== undefined && e.ts >= since && e.ts - since < AWAY_MS ? Math.round((e.ts - since) / 1000) : undefined
  return { skill: e.skill ?? '', ts: e.ts, ok, difficulty: e.difficulty, hints: e.hints, unseen: !!e.unseen, step: e.step, ...(secs !== undefined ? { secs } : {}) }
}

export const replay = (events: readonly LogEvent[], from = initial()) => events.reduce(apply, from)

type At = { seg: Segment; step: Step; index: number; warm?: WarmItem }

export function current(c: Ctx): At | undefined {
  const w = c.state.warm
  const item = w?.items[w.i]
  if (item) {
    const seg = c.segments[item.seg]
    const index = seg?.steps.findIndex(x => x.id === item.step) ?? -1
    if (seg && index >= 0) return { seg, step: seg.steps[index]!, index, warm: item }
  }
  const pos = c.state.pos
  const seg = pos && c.segments[pos.seg]
  const step = pos && seg?.steps[pos.step]
  return seg && step ? { seg, step, index: pos.step } : undefined
}

const segmentOrder = (course: Course) => course.phases.flatMap(p => p.segments)
const resultKey = (c: Ctx, at: At) => at.warm ? `warm${c.state.warm?.n ?? 0}:${at.step.id}` : at.step.id
const classOf = (c: Ctx, skill: string | undefined, fallback: MistakeClass, tag?: string): MistakeClass =>
  tag && c.state.weak[tag] && c.state.weak[tag]!.status !== 'resolved' ? fallback : classify(c.state, skill, fallback)

const prereqOf = (c: Ctx, skill?: string, tag?: string) =>
  c.course?.skills.find(k => k.id === skill)?.misconceptions.find(m => m.tag === tag)?.prereq

const graded = (c: Ctx, at: At) => ({
  skill: at.step.skill, difficulty: at.step.difficulty, unseen: at.step.unseen && !c.state.asked?.[at.step.id], hints: c.state.hints[at.step.id] ?? 0,
  ...(at.step.remedy ? { remedy: at.step.remedy } : {}),
  ...(at.step.uses?.length ? { uses: at.step.uses } : {}),
  ...(at.warm ? { review: at.warm.key, rk: resultKey(c, at) } : {}),
})

function enter(c: Ctx, seg: string, step: number, extra: { back?: { seg: string; step: number }; from?: string; drill?: string } = {}): Out {
  const s = c.segments[seg]
  const events: LogEvent[] = [{ ts: c.now, type: 'enter', seg, step, ...extra }]
  const fresh = !!s?.practice?.adds && !c.state.added[seg]
  const effects: Effect[] = s?.practice && ((step === 0 && !extra.back) || fresh || !!s.steps[step]?.check) ? [{ kind: 'practice', dir: s.practice.dir, seg }] : []
  const order = c.course ? segmentOrder(c.course) : []
  const next = order[order.indexOf(seg) + 1]
  const left = s ? s.steps.slice(step + 1).filter(x => !x.drill).length : 0
  if (next && !c.segments[next] && left <= PREPARE_AHEAD) effects.push({ kind: 'prepare', after: seg })
  return { events, effects }
}

const rootOf = (c: Ctx, at: At) => {
  const back = at.step.drill && !at.warm ? c.state.pos?.back : undefined
  const id = back && c.segments[back.seg]?.steps[back.step]?.id
  return back && id ? { back, id } : { back: { seg: at.seg.id, step: at.index }, id: at.step.id }
}

function advance(c: Ctx, skipBranch = false): Out {
  const at = current(c)
  if (!at) return NONE
  const { seg, step, index } = at
  const branch = c.state.result[step.id]?.branch
  if (!skipBranch && branch && !c.state.solved[step.id]) {
    const [bseg, bid] = branch.includes('/') ? branch.split('/') as [string, string] : [seg.id, branch]
    const target = c.segments[bseg]?.steps.findIndex(x => x.id === bid) ?? -1
    const tag = c.segments[bseg]?.steps[target]?.remedy ?? c.state.mistakes.at(-1)?.tag
    const drill = c.segments[bseg]?.steps[target]
    const root = rootOf(c, at)
    if (target >= 0 && drill && !c.state.result[drill.id]) return enter(c, bseg, target, { back: root.back, from: root.id, ...(tag ? { drill: tag } : {}) })
  }
  const back = c.state.pos?.back
  if (back && !skipBranch) return enter(c, back.seg, back.step)
  const from = back && skipBranch ? { seg: c.segments[back.seg]!, index: back.step } : { seg, index }
  const nextIndex = from.seg.steps.findIndex((x, i) => i > from.index && !x.drill)
  if (nextIndex >= 0) return enter(c, from.seg.id, nextIndex)
  // Before the next segment: one more go at what is still open in this one, once
  const gate = c.state.gated[from.seg.id] ? [] : dueItems(c).filter(i => c.state.weak[i.key]?.status === 'open' && from.seg.skills.includes(c.state.weak[i.key]!.skill ?? ''))
  if (gate.length) return { events: [{ ts: c.now, type: 'warm', items: gate, gate: from.seg.id }], effects: [] }
  const order = c.course ? segmentOrder(c.course) : []
  const nextSeg = order[order.indexOf(from.seg.id) + 1]
  if (nextSeg && c.segments[nextSeg]) return enter(c, nextSeg, 0)
  return { events: [{ ts: c.now, type: 'stage', stage: 'recap' }], effects: nextSeg ? [{ kind: 'prepare', after: from.seg.id }] : [] }
}

function remedyFor(c: Ctx, at: At, cls: MistakeClass, tag?: string, scripted?: string): { branch?: string; effects: Effect[] } {
  if (at.warm || cls === 'slip' || (c.state.drills[rootOf(c, at).id] ?? 0) >= MAX_DRILLS) return { effects: [] }
  const used = new Set(tag ? c.state.weak[tag]?.used ?? [] : [])
  const fresh = (segId: string, i: number, x: Step) => x.drill && !used.has(`${segId}/${i}`) && !c.state.result[x.id]
  const local = at.seg.steps.findIndex((x, i) => fresh(at.seg.id, i, x) && (x.id === scripted || (!!tag && x.remedy === tag)))
  if (local >= 0) return { branch: at.seg.steps[local]!.id, effects: [] }
  for (const g of Object.values(c.segments)) {
    if (!g.id.startsWith('remedy-')) continue
    const i = g.steps.findIndex((x, j) => fresh(g.id, j, x) && !!tag && x.remedy === tag)
    if (i >= 0) return { branch: `${g.id}/${g.steps[i]!.id}`, effects: [] }
  }
  return { effects: tag ? [{ kind: 'remedy', tag, ...(at.step.skill ? { skill: at.step.skill } : {}) }] : [] }
}

const isSequence = (step: Step) => step.kind === 'reorder' || step.kind === 'trace'

function answer(c: Ctx, at: At, n: number): Out {
  const step = at.step
  const rk = resultKey(c, at)
  if (!step.choices || !step.key || c.state.result[rk]) return NONE
  const i = n - 1
  if (!step.choices[i]) return NONE
  let picked = [i]
  if (isSequence(step)) {
    const draft = c.state.draft[rk] ?? []
    if (step.kind === 'reorder' && draft.includes(i)) return NONE
    picked = [...draft, i]
    if (picked.length < step.key.length) return { events: [{ ts: c.now, type: 'pick', step: rk, picked }], effects: [] }
  }
  const same = (a: number, b: number) => a === b || step.choices![a]!.text === step.choices![b]!.text
  const miss = isSequence(step) ? picked.findIndex((p, j) => !same(p, step.key![j]!)) : step.key.includes(i) ? -1 : 0
  const right = miss < 0
  const choice = step.choices[right ? i : picked[miss]!]!
  const wrong = right ? undefined : step.wrong?.find(w => w.match.choice === picked[miss])
  const tag = right ? undefined : wrong?.tag ?? step.remedy ?? (at.warm && !at.warm.key.startsWith('skill:') ? at.warm.key : undefined)
  const cls = right ? undefined : classOf(c, step.skill, wrong?.class ?? 'misconception', tag)
  const fix = cls ? remedyFor(c, at, cls, tag, wrong?.branch) : { effects: [] }
  const prereq = cls ? prereqOf(c, step.skill, tag) : undefined
  return {
    events: [{
      ts: c.now, type: 'answer', step: step.id, picked, verdict: right ? 'right' : 'wrong',
      feedback: right ? (isSequence(step) ? 'Right, all of it.' : choice.why) : (wrong?.feedback ?? (isSequence(step) ? `${miss === 0 ? 'The first' : `Number ${miss + 1}`} is not right yet: ${choice.why}` : choice.why)),
      ...(cls ? { class: cls } : {}), ...(tag ? { tag } : {}), ...(prereq ? { prereq } : {}),
      ...(fix.branch ? { branch: fix.branch } : {}),
      ...graded(c, at),
    }],
    effects: fix.effects,
  }
}

function hint(c: Ctx, step: Step): Out {
  const level = (c.state.hints[step.id] ?? 0) + 1
  if (!step.hints || !c.state.tries[step.id] || level > step.hints.length || c.state.solved[step.id]) return NONE
  return { events: [{ ts: c.now, type: 'hint', step: step.id, level }], effects: [] }
}

export function dueItems(c: Ctx): WarmItem[] {
  const s = c.state
  const questions = Object.values(c.segments).flatMap(g => g.steps.map((x, i) => ({ g, x, i }))).filter(({ x }) => x.choices && x.key)
  const pick = (key: string, match: (x: Step) => boolean, avoid: string[]): WarmItem | undefined => {
    const all = questions.filter(q => match(q.x))
    const best = all.find(q => !s.result[q.x.id] && !avoid.includes(q.x.id)) ?? all.find(q => !avoid.includes(q.x.id)) ?? all[0]
    return best && { seg: best.g.id, step: best.x.id, key }
  }
  const items: WarmItem[] = []
  const weak = Object.values(s.weak).filter(w => w.status === 'open' || (w.status === 'recheck' && (w.due ?? 0) <= c.now))
    .sort((a, b) => b.count - a.count || a.last - b.last)
  for (const w of weak) {
    const item = w.tag
      ? pick(w.key, x => x.remedy === w.tag || !!x.wrong?.some(r => r.tag === w.tag), w.steps)
      : pick(w.key, x => x.skill === w.skill, w.steps)
    if (item && !items.some(i => i.step === item.step)) items.push(item)
  }
  for (const [key, card] of Object.entries(s.cards)) {
    if (!key.startsWith('skill:') || card.state !== 'review' || retrievability(card, c.now) >= RETENTION) continue
    const skill = key.slice(6)
    const item = pick(key, x => x.skill === skill, [])
    if (item && !items.some(i => i.step === item.step)) items.push(item)
  }
  return items.slice(0, WARM_ITEMS)
}

export function press(c: Ctx, p: Press): Out {
  if (!c.course) return NONE
  const s = c.state
  const action = 'action' in p ? p.action : undefined
  if (c.welcome && action === 'continue') {
    const items = dueItems(c)
    return items.length ? { events: [{ ts: c.now, type: 'warm', items }], effects: [] } : NONE
  }
  if (s.stage === 'intake') {
    const q = c.course.intake.find(x => s.intake[x.id] === undefined)
    const a = !q ? undefined : 'choose' in p ? (q.options[p.choose - 1] !== undefined ? p.choose - 1 : undefined) : 'text' in p ? p.text.trim().slice(0, 300) || undefined : undefined
    if (!q || a === undefined) return NONE
    const events: LogEvent[] = [{ ts: c.now, type: 'intake', q: q.id, a }]
    const isLast = c.course.intake.filter(x => s.intake[x.id] === undefined).length === 1
    if (!isLast) return { events, effects: [] }
    // The answers are in: check the machine, and write lesson 1 for this learner (the course may still be written)
    events.push({ ts: c.now, type: 'stage', stage: 'setup' })
    const first = segmentOrder(c.course)[0]
    return { events, effects: [{ kind: 'setup' }, ...(first && !c.segments[first] ? [{ kind: 'prepare' as const, after: '', seg: first }] : [])] }
  }
  if (s.stage === 'setup') {
    if (c.busy) return NONE
    if (action === 'setup') return { events: [], effects: [{ kind: 'setup' }] }
    if (action === 'heal') return { events: [], effects: [{ kind: 'heal' }] }
    if (action === 'continue' && setupDone(c)) return { events: [{ ts: c.now, type: 'stage', stage: 'curriculum' }], effects: [] }
    return NONE
  }
  if (action?.startsWith('reset') && ['curriculum', 'recap', 'lesson'].includes(s.stage)) return reset(c, action.split(':')[1], action.split(':')[2] === 'fresh')
  if (s.stage === 'curriculum' || s.stage === 'recap') {
    if (action === 'start') {
      const go = resume(c)
      return go ? { events: [{ ts: c.now, type: 'stage', stage: 'lesson' }, ...go.events], effects: go.effects } : NONE
    }
    if (action === 'retry' && s.done && ahead(c) === 'missing') return { events: [], effects: [{ kind: 'prepare', after: s.done }] }
    if (action === 'curriculum' && s.stage === 'recap') return { events: [{ ts: c.now, type: 'stage', stage: 'curriculum' }], effects: [] }
    return NONE
  }
  const at = current(c)
  const missing = missingSegment(c)
  if (!at && missing && action === 'retry' && !c.preparing) return { events: [], effects: [{ kind: 'prepare', after: '', seg: missing }] }
  if (!at) return NONE
  const { step } = at
  if (at.warm) {
    if ('choose' in p) return answer(c, at, p.choose)
    if (!((action === 'next' && s.result[resultKey(c, at)]) || action === 'skip')) return NONE
    const ev = { ts: c.now, type: action === 'skip' ? 'warm' : 'warm-next', items: [] } as LogEvent
    const after = { ...c, state: apply(s, ev) }
    // The end of a check before the next segment goes straight on to it
    if (s.warm?.gate && !current(after)?.warm) { const go = advance(after); return { events: [ev, ...go.events], effects: go.effects } }
    return { events: [ev], effects: [] }
  }
  if (action === 'ask') return { events: [{ ts: c.now, type: 'aside', on: true, step: step.id }], effects: [{ kind: 'ask' }] }
  if (action === 'back') return { events: [{ ts: c.now, type: 'aside', on: false }], effects: [] }
  // A question of their own about the step, typed beside it while stepped aside
  if (s.aside && 'text' in p) return p.text.trim() ? { events: [], effects: [{ kind: 'ask', question: p.text.trim().slice(0, 300) }] } : NONE
  if (action === 'curriculum') return { events: [{ ts: c.now, type: 'stage', stage: 'curriculum' }], effects: [] }
  if (action === 'dontknow' && step.choices && !s.result[step.id] && s.idk[step.id] === undefined) return { events: [{ ts: c.now, type: 'dontknow', step: step.id, ...(step.skill ? { skill: step.skill } : {}) }], effects: [] }
  if ('choose' in p) return answer(c, at, p.choose)
  const draft = s.draft[step.id] ?? []
  if ((action === 'undo' || action === 'clear') && draft.length && !s.result[step.id]) return { events: [{ ts: c.now, type: 'pick', step: step.id, picked: action === 'undo' ? draft.slice(0, -1) : [] }], effects: [] }
  const frame = s.frame[step.id] ?? 0
  if (step.frames && (action === 'frame-next' || action === 'frame-prev')) {
    const i = Math.max(0, Math.min(step.frames.length - 1, frame + (action === 'frame-next' ? 1 : -1)))
    return i === frame ? NONE : { events: [{ ts: c.now, type: 'frame', step: step.id, i }], effects: [] }
  }
  if (action === 'hint') return hint(c, step)
  if (action === 'check' && step.check && !c.busy && c.state.result[step.id]?.tone !== 'wait') return { events: [], effects: [{ kind: 'check', step: step.id }] }
  if (action === 'next' && canLeave(c, step)) return advance(c)
  if (action === 'skip' && canSkip(c, step)) {
    const go = advance(c, true)
    return { events: [{ ts: c.now, type: 'skip', step: step.id }, ...go.events], effects: go.effects }
  }
  return NONE
}

// Where Continue leads: the kept step, or the next segment once the last one is finished
function resume(c: Ctx): Out | undefined {
  const s = c.state
  if (s.done) {
    const next = nextSegment(c, s.done)
    return next && c.segments[next] ? enter(c, next, 0) : undefined
  }
  if (s.pos) return enter(c, s.pos.seg, s.pos.step, s.pos.back ? { back: s.pos.back } : {})
  const first = c.course && segmentOrder(c.course).find(id => c.segments[id])
  return first ? enter(c, first, 0) : undefined
}

const missingSegment = (c: Ctx) => { const seg = c.state.pos?.seg; return seg && !c.segments[seg] ? seg : undefined }
function reset(c: Ctx, phaseId?: string, fresh = false): Out {
  const course = c.course!
  const phases = phaseId ? course.phases.filter(p => p.id === phaseId) : course.phases
  if (!phases.length) return NONE
  const segs = phases.flatMap(p => p.segments)
  const order = segmentOrder(course)
  const first = order.indexOf(segs[0]!)
  const at = c.state.done ? order.indexOf(c.state.done) + 1 : c.state.pos ? order.indexOf(c.state.pos.seg) : 0
  const before = order[first - 1]
  const event: LogEvent = {
    ts: c.now, type: 'reset', segs, rewind: at >= first, ...(before ? { before } : {}),
    steps: segs.flatMap(id => c.segments[id]?.steps.map(x => x.id) ?? []),
    skills: [...new Set(phases.flatMap(p => p.skills))],
  }
  return { events: [event, { ts: c.now, type: 'stage', stage: 'curriculum' }], effects: [{ kind: 'restart', segs, ...(fresh ? { fresh } : {}) }] }
}

const nextSegment = (c: Ctx, seg: string) => { const order = c.course ? segmentOrder(c.course) : []; return order[order.indexOf(seg) + 1] }
// After a finished segment: is the next one ready, being written, missing (nobody writing it), or is the course over
const ahead = (c: Ctx) => {
  if (!c.state.done) return undefined
  const next = nextSegment(c, c.state.done)
  return !next ? 'end' : c.segments[next] ? 'ready' : c.preparing ? 'writing' : 'missing'
}

// A question without choices (one cached before the schema refused it, #15) has nothing to answer: Next goes on
const canLeave = (c: Ctx, step: Step) =>
  QUESTION_KINDS.has(step.kind) && step.choices ? !!c.state.result[step.id] || c.state.idk[step.id] !== undefined : TASK_KINDS.has(step.kind) ? !!c.state.solved[step.id] || !!c.state.result[step.id]?.branch : true
const canSkip = (c: Ctx, step: Step) => TASK_KINDS.has(step.kind) && !c.state.solved[step.id] && (c.state.tries[step.id] ?? 0) >= 2

export const setupDone = (c: Ctx) => !!c.course && c.course.setup.length > 0 && c.course.setup.every(r => c.state.setup[r.id]?.status === 'ok')

export type ProbeResult = { id: string; ok: boolean; got: string }

export function checked(c: Ctx, stepId: string, results: readonly ProbeResult[]): Out {
  const at = current(c)
  if (!at || at.step.id !== stepId) return NONE
  const step = at.step
  const failed = results.find(r => !r.ok)
  if (!failed) return { events: [{ ts: c.now, type: 'check', step: step.id, ok: true, feedback: okText(step), ...graded(c, at) }], effects: [] }
  const wrong = step.wrong?.find(w => w.match.probe === failed.id && (!w.match.got || new RegExp(w.match.got, 'i').test(failed.got)))
  const got = failed.got.slice(0, 400)
  if (wrong) {
    const cls = classOf(c, step.skill, wrong.class, wrong.tag)
    const fix = remedyFor(c, at, cls, wrong.tag, wrong.branch)
    const prereq = prereqOf(c, step.skill, wrong.tag)
    return {
      events: [{
        ts: c.now, type: 'check', step: step.id, ok: false, probe: failed.id, got, class: cls, feedback: wrong.feedback,
        ...(wrong.tag ? { tag: wrong.tag } : {}), ...(prereq ? { prereq } : {}), ...(fix.branch ? { branch: fix.branch } : {}), ...graded(c, at),
      }],
      effects: fix.effects,
    }
  }
  const esc = `${step.id}#${(c.state.tries[step.id] ?? 0) + 1}`
  return {
    events: [{ ts: c.now, type: 'check', step: step.id, ok: false, probe: failed.id, got, pending: esc, ...factOf(step, failed), ...graded(c, at) }],
    effects: [{ kind: 'escalate', esc, step: step.id, probe: failed.id, got }],
  }
}

function factOf(step: Step, failed: ProbeResult): { feedback?: string } {
  const want = step.check?.probes.find(p => p.id === failed.id)?.expect.equals
  return want !== undefined && failed.got ? { feedback: `The check found "${failed.got.slice(0, 60)}" where the task expects "${want}".` } : {}
}

const okText = (step: Step) => step.choices ? 'Right.' : 'Done. That is the result the task asked for.'

export function taught(c: Ctx, esc: string, v: { class: MistakeClass; tag?: string; feedback: string }): Out {
  const at = current(c)
  const [stepId] = esc.split('#')
  if (!at || at.step.id !== stepId || c.state.result[stepId]?.tone !== 'wait') return NONE
  return { events: [{ ts: c.now, type: 'feedback', step: stepId, esc, class: v.class, feedback: v.feedback, ...(v.tag ? { tag: v.tag } : {}), ...(at.step.skill ? { skill: at.step.skill } : {}) }], effects: [] }
}

const act = (id: string, label: string, primary = false, key?: string): Action => ({ id, label, ...(primary ? { primary } : {}), ...(key ? { key } : {}) })
const keepSharp = (c: Ctx) => Object.values(c.state.weak).filter(w => w.status !== 'resolved')
const skillTitle = (c: Ctx, id?: string) => c.course?.skills.find(k => k.id === id)?.title ?? id ?? ''

export function screen(c: Ctx): Screen {
  const s = c.state
  if (c.build) return buildScreen(c.build)
  if (!c.course) return { kind: 'empty', title: 'Teach Me', body: 'Say "teach me <subject>" in the chat to start.', actions: [] }
  const course = c.course
  if (c.progress) return progressScreen(c)
  if (c.welcome && s.stage === 'lesson' && current(c)) {
    const at = current(c)!
    const due = dueItems(c).length
    const st = stats(course, s, c.now)
    const sofar = st.answers ? `\n\nSo far: ${pct(st.accuracy)} right over ${st.answers} answers${st.streak > 1 ? `, ${st.streak} days in a row` : ''}.` : ''
    return {
      kind: 'welcome', title: course.subject, progress: overall(c),
      body: `Welcome back.\n\nYou stopped at: **${at.seg.title}** · step ${stepNumber(at.seg, at.index)}.${sofar}${due ? `\n\nFirst, ${due === 1 ? 'one thing' : `${due} things`} to keep sharp.` : ''}`,
      actions: [act('continue', 'Continue', true, 'enter'), act('curriculum', 'Path'), PROGRESS],
    }
  }
  if (s.stage === 'intake') {
    const open = course.intake.filter(x => s.intake[x.id] === undefined)
    const q = open[0]
    if (!q) return { kind: 'intake', title: course.subject, body: 'Thanks.', actions: [] }
    const n = course.intake.length - open.length + 1
    return {
      kind: 'intake', title: course.subject, progress: { label: `${n} of ${course.intake.length}`, done: n - 1, total: course.intake.length },
      body: q.q, choices: q.options.map((text, i) => ({ n: i + 1, text })), input: { placeholder: 'Or say it in your own words' }, actions: [],
    }
  }
  if (s.stage === 'setup') {
    const done = setupDone(c)
    const mark = (st?: string) => st === 'ok' ? 'ok' as const : st === 'running' ? 'run' as const : st === 'failed' ? 'fail' as const : 'todo' as const
    // One click approves installing and configuring everything listed as missing or failed
    const needs = course.setup.some(r => ['missing', 'failed'].includes(s.setup[r.id]?.status ?? ''))
    const tools = course.setup.some(r => s.setup[r.id]?.status === 'missing')
    return {
      kind: 'setup', title: 'Your setup',
      lines: course.setup.map(r => ({ mark: mark(s.setup[r.id]?.status), text: r.title, ...(s.setup[r.id]?.note ? { detail: s.setup[r.id]!.note } : {}) })),
      ...(c.busy ? { result: { tone: 'wait' as const, text: c.busy } } : tools ? { result: { tone: 'wait' as const, text: 'Teach Me installs and sets up what is missing for you.' } } : {}),
      actions: c.busy ? [] : done ? [act('continue', 'Continue', true, 'enter')]
        : needs ? [act('heal', tools ? 'Install everything' : 'Fix it for me', true, 'enter'), act('setup', 'Check again')]
        : [act('setup', 'Set up', true, 'enter')],
    }
  }
  if (s.stage === 'curriculum') {
    const sharp = keepSharp(c)
    return {
      kind: 'curriculum', title: `Your path to: ${course.goal}`, progress: overall(c),
      lines: course.phases.map((p, i) => {
        const practiced = p.skills.filter(id => ['practiced', 'demonstrated', 'mastered'].includes(skillState(s, id, c.now))).length
        const toSharpen = sharp.filter(w => w.skill && p.skills.includes(w.skill)).length
        return {
          mark: phaseDone(c, p.skills) ? 'ok' as const : (s.pos ? course.phases.findIndex(x => x.segments.includes(s.pos!.seg)) === i : i === 0) ? 'now' as const : 'todo' as const,
          text: p.title,
          detail: p.project ? `Project · ${p.segments.length} milestones` : p.skills.length
            ? [`${practiced} of ${p.skills.length} skills`, toSharpen ? `${toSharpen} to keep sharp` : ''].filter(Boolean).join(' · ')
            : 'Prepared when you get there',
        }
      }),
      ...(!segmentOrder(course).some(id => c.segments[id])
        ? { result: { tone: 'wait' as const, text: 'Your first lesson is being written and checked. About a minute.' }, actions: [PROGRESS] }
        : { ...nextParts(c), actions: [...nextActions(c, s.pos ? 'Continue' : `Start ${course.phases[0]?.title ?? ''}`.trim()), PROGRESS] }),
    }
  }
  if (s.stage === 'recap') {
    const learned = [...new Set(s.evidence.filter(e => e.ok).map(e => e.skill))]
    const weak = [...new Set(keepSharp(c).map(w => skillTitle(c, w.skill)).filter(Boolean))]
    return {
      kind: 'recap', title: 'Today', progress: overall(c),
      lines: [
        ...learned.map(id => ({ mark: 'ok' as const, text: `Stronger: ${skillTitle(c, id)}` })),
        ...weak.slice(0, 3).map(t => ({ mark: 'todo' as const, text: `Keep sharp: ${t}` })),
      ],
      ...nextParts(c),
      actions: [...nextActions(c, 'Next lesson'), nextActions(c, '').length ? act('curriculum', 'Path') : act('curriculum', 'Path', true, 'enter'), PROGRESS],
    }
  }
  const at = current(c)
  if (!at) return missingScreen(c, course.subject)
  const { seg, step, index } = at
  const rk = resultKey(c, at)
  const res = s.result[rk]
  if (at.warm && s.warm) {
    const n = s.warm.items.length
    const gate = !!s.warm.gate
    return {
      kind: 'question', title: step.title, progress: { label: `${gate ? 'Before you move on' : 'Warm-up'} · ${s.warm.i + 1} of ${n}`, done: s.warm.i, total: n },
      body: step.body, ...(step.code ? { code: { lang: step.code.lang, source: step.code.source } } : {}),
      ...answerParts(step, res, s.draft[rk]),
      ...(res ? { result: { tone: res.tone, text: res.text } } : {}),
      actions: res ? [act('next', s.warm.i + 1 < n ? 'Next' : gate ? 'Continue' : 'Back to your lesson', true, 'enter')] : [act('skip', gate ? 'Skip this check' : 'Skip the warm-up')],
    }
  }
  const total = seg.steps.filter(x => !x.drill).length
  const progress = { label: `${seg.title} · ${step.drill ? 'practice' : `${stepNumber(seg, index)} of ${total}`}`, done: stepNumber(seg, index) - 1, total }
  const level = s.hints[step.id] ?? 0
  const base = {
    title: step.title, progress, body: step.body,
    ...(step.more ? { more: step.more } : {}), ...(step.compare ? { compare: step.compare } : {}),
    ...(step.code ? { code: { lang: step.code.lang, source: step.code.source } } : {}),
    ...(step.code?.run && (!step.choices || res) ? { output: step.code.run.out } : {}),
    ...(level && step.hints ? { hint: { level, text: step.hints[level - 1]! } } : {}),
  }
  const ask = act('ask', 'Ask', false, 'a')
  if (s.aside) {
    const asked = c.asked
    return {
      kind: 'step', ...base,
      result: asked?.answer ? { tone: 'info', text: asked.answer }
        : asked ? { tone: 'wait', text: asked.question ? `Answering "${asked.question}"…` : 'Explaining this step…' }
        : { tone: 'info', text: 'Ask in the chat. Your place here is kept.' },
      input: { placeholder: 'Ask your own question about this step' },
      actions: [act('back', 'Back to step', true, 'b')],
    }
  }
  if (step.choices) {
    const draft = s.draft[step.id] ?? []
    const edit = !res && draft.length ? [act('undo', 'Undo', false, 'u'), act('clear', 'Start over')] : []
    const unsure = s.idk[step.id] !== undefined
    const result = res ? { tone: res.tone, text: res.text } : unsure ? { tone: 'info' as const, text: teaching(at) } : undefined
    return {
      kind: 'question', ...base, ...answerParts(step, res, draft),
      ...(result ? { result } : {}),
      actions: res
        ? [act('next', res.branch ? 'Practice this' : 'Next', true, 'enter'), ask]
        : [...edit, unsure ? act('next', 'Move on for now', false, 's') : act('dontknow', "I don't know", false, 'd'), ask],
    }
  }
  if (step.check) {
    const solved = !!s.solved[step.id]
    const canHint = !!step.hints && !!s.tries[step.id] && level < step.hints.length && !solved
    const result = c.busy ? { tone: 'wait' as const, text: c.busy } : res ? { tone: res.tone, text: res.text } : undefined
    const actions = solved
      ? [act('next', 'Next', true, 'enter')]
      : [
        act('check', res ? 'Check again' : 'Check', true, 'enter'),
        ...(res?.branch ? [act('next', 'Practice this', false, 'p')] : []),
        ...(canHint ? [act('hint', `Hint ${level + 1}`, false, 'h')] : []),
        ...(canSkip(c, step) ? [act('skip', 'Move on for now', false, 's')] : []),
        ask,
      ]
    const where = seg.practice ? { where: { dir: seg.practice.dir, ...(step.open ? { file: step.open } : {}) } } : {}
    return { kind: 'exercise', ...base, ...where, ...(result ? { result } : {}), actions }
  }
  if (step.frames) {
    const i = s.frame[step.id] ?? 0
    const f = step.frames[i]!
    const last = i === step.frames.length - 1
    return {
      kind: 'step', ...base, frame: { i, n: step.frames.length, note: f.note, ...(f.code ? { code: f.code } : {}), ...(f.state ? { state: f.state } : {}) },
      actions: [
        ...(last ? [act('next', 'Next', true, 'enter')] : [act('frame-next', 'Next frame', true, 'enter')]),
        ...(i > 0 ? [act('frame-prev', 'Previous frame', false, 'left')] : []),
        ...(last ? [] : [act('next', 'Skip ahead', false, 's')]), ask,
      ],
    }
  }
  return { kind: 'step', ...base, actions: [act('next', 'Next', true, 'enter'), ask] }
}

// What "I don't know" shows: the step's own explanation, or the earlier step that teaches its skill
function teaching(at: At) {
  const intro = at.seg.steps.slice(0, at.index).reverse().find(x => x.skill === at.step.skill && !x.choices && !x.check)
  return `That is fine: this one is marked to come back later.\n\n${at.step.more ?? intro?.body ?? 'Ask in the chat for the idea behind it.'}\n\nTry an answer now, or move on.`
}

function answerParts(step: Step, res: { picked?: number[]; tone?: string } | undefined, draft: number[] = []) {
  if (!isSequence(step)) return { choices: choicesOf(step, res) }
  const picked = res?.picked ?? draft
  const ok = (j: number) => step.choices![picked[j]!]!.text === step.choices![step.key![j]!]!.text
  const mark = (j: number) => res ? (ok(j) ? 'right' as const : 'wrong' as const) : undefined
  const choices = step.choices!.map((ch, i) => ({ n: i + 1, text: ch.text, ...(ch.code ? { code: ch.code } : {}), ...(step.kind === 'reorder' && picked.includes(i) ? { used: true } : {}) }))
  if (step.kind === 'reorder') return { ...(res ? {} : { choices }), built: picked.map((p, j) => ({ text: step.choices![p]!.code ?? step.choices![p]!.text, ...(mark(j) ? { mark: mark(j) } : {}) })) }
  let blank = 0
  const rows = (step.trace?.rows ?? []).map(cells => {
    const first = blank
    let at: number | undefined
    const filled = cells.map((cell, k) => {
      if (cell !== '?') return cell
      const j = blank++
      if (j === picked.length && !res) at = k
      return j < picked.length ? step.choices![picked[j]!]!.text : '?'
    })
    const marks = res ? Array.from({ length: blank - first }, (_, x) => ok(first + x)) : []
    return { cells: filled, ...(at !== undefined ? { at } : {}), ...(marks.length ? { mark: marks.every(Boolean) ? 'right' as const : 'wrong' as const } : {}) }
  })
  return { ...(res ? {} : { choices }), table: { columns: step.trace?.columns ?? [], rows } }
}

function choicesOf(step: Step, res?: { picked?: number[] }) {
  const picked = res?.picked ?? []
  return (step.choices ?? []).map((ch, i) => ({
    n: i + 1, text: ch.text, ...(ch.code ? { code: ch.code } : {}),
    ...(res ? { mark: step.key?.includes(i) ? (picked.includes(i) ? 'right' as const : 'key' as const) : picked.includes(i) ? 'wrong' as const : undefined, why: ch.why } : {}),
  }))
}

const NEXT_TEXT = {
  ready: { tone: 'right', text: 'Your next lesson is ready.' },
  writing: { tone: 'wait', text: 'Your next lesson is being written and checked. About a minute.' },
  missing: { tone: 'info', text: 'Your next lesson is not written yet.' },
  end: { tone: 'right', text: 'You finished the course.' },
} as const
const nextParts = (c: Ctx) => {
  const a = ahead(c)
  if (a === 'writing' && c.prepSince !== undefined) return writingPart(c)
  if (a === 'missing' && c.prepError) return { result: { tone: 'wrong' as const, text: `Your next lesson could not be written: ${c.prepError}` } }
  return a ? { result: NEXT_TEXT[a] } : {}
}
function missingScreen(c: Ctx, title: string): Screen {
  const body = 'Preparing your lesson…'
  if (c.preparing || !missingSegment(c)) return { kind: 'empty', title, body, ...writingPart(c), actions: [] }
  const why = c.prepError ? `Your lesson could not be written: ${c.prepError}` : 'Your lesson is not written yet.'
  return { kind: 'empty', title, body, result: { tone: c.prepError ? 'wrong' : 'info', text: why }, actions: [act('retry', 'Write it now', true, 'enter'), PROGRESS] }
}
const writingPart = (c: Ctx) => {
  if (!c.preparing || c.prepSince === undefined) return {}
  const sec = Math.max(0, Math.round((c.now - c.prepSince) / 1000))
  return { result: { tone: 'wait' as const, text: `${NEXT_TEXT.writing.text} ${sec}s so far.${sec > 180 ? ' Taking longer than usual: it is still trying.' : ''}` } }
}
const nextActions = (c: Ctx, label: string): Action[] => {
  const a = ahead(c)
  return !a || a === 'ready' ? [act('start', label, true, 'enter')] : a === 'missing' ? [act('retry', 'Write it now', true, 'enter')] : []
}

const PROGRESS = act('progress', 'Progress', false, 'g')

function buildScreen(b: Build): Screen {
  const title = 'Build with me'
  if (b.stage === 'pick') return {
    kind: 'intake', title,
    body: 'Pick a project to build together. In each milestone the setup and tests are added for you, then you write the core.',
    choices: b.suggestions.map((x, i) => ({ n: i + 1, text: `${x.title}: ${x.pitch}` })),
    input: { placeholder: b.suggestions.length ? 'Or describe your own project' : 'Describe the project you want to build' },
    ...(b.note ? { result: { tone: 'info' as const, text: b.note } } : {}),
    actions: [act('back', 'Not now', false, 'b')],
  }
  if (b.stage === 'planning') return {
    kind: 'intake', title, body: `**${b.title}**`,
    result: { tone: 'wait', text: 'Planning the milestones and setting up the first one. About a minute.' },
    actions: [act('back', 'Keep learning meanwhile', true, 'b')],
  }
  return { kind: 'intake', title, body: `**${b.title}** is planned.`, result: { tone: 'right', text: b.note ?? 'It starts when this lesson ends.' }, actions: [act('back', 'Back to the lesson', true, 'enter')] }
}

// The project phase goes right after the learner's current segment (first, before any lesson): the rest of that phase moves after it
export function withProject(course: Course, s: LearnerState, phase: Phase): Phase[] {
  const at = s.done ?? s.pos?.seg
  const i = at ? course.phases.findIndex(p => p.segments.includes(at)) : -1
  const p = course.phases[i]
  if (!at || !p) return [phase, ...course.phases]
  const k = p.segments.indexOf(at)
  const rest = p.segments.slice(k + 1)
  return [
    ...course.phases.slice(0, i), { ...p, segments: p.segments.slice(0, k + 1) }, phase,
    ...(rest.length ? [{ id: `${p.id}-after-${phase.id}`, title: `${p.title} (continued)`, skills: [], segments: rest }] : []),
    ...course.phases.slice(i + 1),
  ]
}
const SKILL_MARK = { 'not-started': 'todo', learning: 'now', practiced: 'ok', demonstrated: 'ok', mastered: 'ok' } as const
const stateText = (state: string) => state.replace('-', ' ')

function progressScreen(c: Ctx): Screen {
  const st = stats(c.course!, c.state, c.now)
  const base = { kind: 'progress' as const, title: 'Your progress', progress: overall(c), actions: [act('back', 'Back', true, 'b')] }
  if (!st.answers) return { ...base, body: 'No answers yet. Your accuracy, learning curve, strengths and weaknesses show here after your first questions.' }
  const right = (k: { accuracy: number; answers: number }) => `${Math.round(k.accuracy * k.answers)} of ${k.answers} right`
  const lowest = Math.min(...st.curve), latest = st.curve.at(-1) ?? 0
  return {
    ...base,
    tiles: [
      { label: 'right', value: pct(st.accuracy) },
      { label: 'right first try', value: pct(st.firstTry) },
      { label: 'answers', value: String(st.answers) },
      { label: 'hints per answer', value: st.hintsPerAnswer.toFixed(1) },
      ...(st.medianSecs !== undefined ? [{ label: 'median time', value: `${st.medianSecs} s` }] : []),
      st.streak > 1 ? { label: 'days in a row', value: String(st.streak) } : { label: st.days === 1 ? 'day active' : 'days active', value: String(st.days) },
    ],
    ...(st.curve.length >= 2 ? { chart: { label: `Learning curve: share right over your last ${WINDOW} answers · lowest ${pct(lowest)}, now ${pct(latest)}`, points: st.curve } } : {}),
    groups: [
      { title: 'Strengths', lines: st.strengths.length ? st.strengths.map(k => ({ mark: 'ok' as const, text: k.title, detail: `${right(k)} · ${stateText(k.state)}` })) : [{ mark: 'todo' as const, text: 'Shown after a few right answers on one skill' }] },
      { title: 'To work on', lines: st.weaknesses.length ? st.weaknesses.map(w => ({ mark: 'fail' as const, text: w.text, detail: w.detail })) : [{ mark: 'ok' as const, text: 'Nothing open' }] },
      { title: 'Skills', lines: st.skills.map(k => ({ mark: SKILL_MARK[k.state], text: k.title, detail: [k.answers ? right(k) : '', stateText(k.state), k.idk ? `${k.idk}× "I don't know"` : ''].filter(Boolean).join(' · ') })) },
    ],
  }
}

export function dashboard(c: Ctx): Dashboard | undefined {
  const course = c.course
  if (!course) return undefined
  const s = c.state
  const order = segmentOrder(course)
  const now = s.done ? undefined : s.pos?.seg
  const finished = s.done ? order.indexOf(s.done) : now ? order.indexOf(now) - 1 : -1
  const missing = order.findIndex((id, i) => i > finished && !c.segments[id])
  const status = (id: string, i: number): LessonStatus =>
    i <= finished ? 'done' : id === now ? 'now' : c.segments[id] ? 'ready' : i !== missing ? 'todo' : c.preparing ? 'writing' : c.prepError ? 'failed' : 'todo'
  const lesson = (id: string) => {
    const seg = c.segments[id]
    const st = status(id, order.indexOf(id))
    const steps = st === 'now' && seg && s.pos ? `${stepNumber(seg, s.pos.step)} of ${seg.steps.filter(x => !x.drill).length} steps` : undefined
    return { title: seg?.title ?? 'Not written yet', status: st, ...(steps ? { steps } : {}) }
  }
  const phases = course.phases.map(p => {
    const lessons = p.segments.map(lesson)
    const done = lessons.filter(l => l.status === 'done').length
    const mark = done === lessons.length && lessons.length ? 'ok' as const : lessons.some(l => l.status !== 'todo' && l.status !== 'ready') || done ? 'now' as const : 'todo' as const
    return { id: p.id, title: p.title, mark, done, total: lessons.length, lessons }
  })
  const done = phases.reduce((n, p) => n + p.done, 0)
  return { title: course.subject, goal: course.goal, overall: { label: `${done} of ${order.length} lessons`, done, total: order.length }, phases }
}

const stepNumber = (seg: Segment, index: number) => seg.steps.slice(0, index + 1).filter(x => !x.drill).length || 1

function overall(c: Ctx) {
  const skills = c.course?.skills ?? []
  const done = skills.filter(k => ['practiced', 'demonstrated', 'mastered'].includes(skillState(c.state, k.id, c.now))).length
  return { label: `${done} of ${skills.length} skills`, done, total: skills.length }
}

const phaseDone = (c: Ctx, skills: string[]) =>
  skills.length > 0 && skills.every(id => ['demonstrated', 'mastered'].includes(skillState(c.state, id, c.now)))

// What the learner sees on this step, without the key, so the tutor can talk about it
function stepText(c: Ctx, at: At) {
  const { step } = at
  const res = c.state.result[resultKey(c, at)]
  return [
    `What they see: ${step.body}`,
    step.code ? `Code (${step.code.lang}):\n${step.code.source}` : '',
    step.choices ? `Choices: ${step.choices.map((ch, i) => `${i + 1}) ${ch.code ?? ch.text}`).join(' · ')}` : '',
    res?.picked ? `They answered ${res.picked.map(i => i + 1).join(', ')}: ${res.tone}.` : '',
    c.state.idk[step.id] !== undefined && !res ? 'They said they do not know this one yet.' : '',
  ].filter(Boolean).join('\n')
}

const projectText = (c: Ctx, at: At) => {
  const p = c.course?.phases.find(x => x.project && x.segments.includes(at.seg.id))
  return p ? `Building "${p.title}" together (${p.brief ?? ''}), milestone ${p.segments.indexOf(at.seg.id) + 1} of ${p.segments.length}, in ${p.project}. The system adds the boilerplate and tests; the learner writes the core. Never write their part for them.` : ''
}

const intakeText = (c: Ctx) => {
  const said = c.course!.intake.filter(q => c.state.intake[q.id] !== undefined).map(q => {
    const a = c.state.intake[q.id]!
    return `${q.q} ${typeof a === 'number' ? q.options[a] : `"${a}"`}`
  })
  return said.length ? `They said: ${said.join(' · ')}` : ''
}

export type Band = 'new' | 'beginner' | 'developing' | 'confident'

// The learner's level from their own answers: what they can use, what they are learning, what they have not started
export function level(c: Ctx) {
  const course = c.course!
  const st = stats(course, c.state, c.now)
  const by = (...states: string[]) => course.skills.filter(k => states.includes(skillState(c.state, k.id, c.now))).map(k => k.id)
  const canUse = by('practiced', 'demonstrated', 'mastered')
  const band: Band = !st.answers ? 'new' : st.accuracy >= 0.8 && canUse.length >= 2 ? 'confident' : st.accuracy >= 0.6 && canUse.length >= 1 ? 'developing' : 'beginner'
  return { band, canUse, learning: by('learning'), notStarted: by('not-started'), answers: st.answers, accuracy: st.accuracy, firstTry: st.firstTry }
}

const levelText = (c: Ctx) => {
  const l = level(c)
  const weak = keepSharp(c).map(w => w.tag ?? w.skill).filter(Boolean)
  return [
    `Level: ${l.band}${l.answers ? ` (${pct(l.accuracy)} right over ${l.answers} answers, ${pct(l.firstTry)} right at the first try)` : ' (no answers yet)'}.`,
    `Can use: ${l.canUse.join(', ') || 'nothing yet'}. Still learning: ${l.learning.join(', ') || 'none'}. Not started: ${l.notStarted.join(', ') || 'none'}.`,
    weak.length ? `Open weaknesses: ${weak.join(', ')}.` : '',
  ].filter(Boolean).join('\n')
}

export function snapshot(c: Ctx): string {
  const s = c.state
  if (!c.course) return 'No Teach Me course in this folder.'
  const at = current(c)
  const weak = keepSharp(c).map((w: Weakness) => `${w.tag ?? w.key} (${w.cls}, ${w.count}×, ${w.status})`)
  return [
    `Course: ${c.course.subject} (goal: ${c.course.goal}). Stage: ${s.stage}.`,
    at ? `At: ${at.seg.title} · "${at.step.title}" (${at.step.kind}${at.warm ? ', warm-up' : ''}). Name steps by their title, never an id.` : '',
    at ? stepText(c, at) : '',
    at ? projectText(c, at) : '',
    intakeText(c),
    levelText(c),
    weak.length ? `Keep sharp: ${weak.join(', ')}.` : '',
    s.notes.length ? `Notes from earlier sessions: ${s.notes.slice(-5).join(' · ')}` : '',
    s.aside ? 'The learner stepped aside to ask a question; their place in the lesson is kept.' : '',
    at && canSkip(c, at.step) ? `They have tried this ${c.state.tries[at.step.id]} times, so they may move on now: the lesson's "Move on for now" button. The skill comes back in a later warm-up. If they want to skip, say that and nothing more.` : '',
    at && !s.solved[at.step.id] && (at.step.check || at.step.choices) ? `They have not solved this step yet${at.step.unseen ? ' (a transfer task that proves the skill)' : ''}: explain the idea, never the command or answer that solves it.` : '',
  ].filter(Boolean).join('\n')
}
