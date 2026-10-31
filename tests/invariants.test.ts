import { expect, test } from 'claude-code/testing'

import * as bigo from './fixtures/bigo'
import * as git from './fixtures/git'
import * as python from '../hooks/host/example'
import * as sql from './fixtures/sql'
import { apply, checked, current, press, replay, screen } from '../hooks/engine/engine'
import type { Ctx, Out } from '../hooks/engine/engine'
import { validateSegment } from '../hooks/engine/schema'
import type { Course, LogEvent, Press, Segment, Step } from '../hooks/engine/types'
import { HANDLED_EFFECTS } from '../hooks/lesson'

// Rules that hold for every step an author can write, not only for the built-in ones. Each issue so far that left a
// learner stuck (#5, #14, #15) broke one of them: a button that does nothing, an effect nobody handles, a step that
// can't be left.

const T0 = Date.parse('2026-10-27T10:00:00Z')
const LIBRARY = [git, python, sql, bigo]
const MAX_PRESSES = 40

function at(course: Course, segs: readonly Segment[], seg: Segment, step: number) {
  const log: LogEvent[] = [{ ts: T0, type: 'course', course: course.id }, { ts: T0, type: 'stage', stage: 'lesson' }, { ts: T0, type: 'enter', seg: seg.id, step }]
  const segments = Object.fromEntries([...segs, seg].map(g => [g.id, g]))
  const c: Ctx = { state: replay(log), course, segments, now: T0 }
  const effects: string[] = []
  const take = (out: Out) => {
    for (const e of out.events) { c.state = apply(c.state, e); log.push(e) }
    for (const fx of out.effects) effects.push(fx.kind)
    c.now += 1000
    return out
  }
  return { c, effects, go: (p: Press) => take(press(c, p)), take }
}

const did = (out: Out) => out.events.length + out.effects.length > 0
const where = (c: Ctx) => `${c.state.stage}:${current(c)?.seg ?? ''}:${current(c)?.step.id ?? ''}:${c.state.done ?? ''}`

// A learner who knows the answer: picks the key, writes code that passes, and presses the main button.
// Returns why the step could not be left, or undefined once the learner is somewhere else.
function leave(l: ReturnType<typeof at>, step: Step): string | undefined {
  const from = where(l.c)
  for (let i = 0; i < MAX_PRESSES; i++) {
    const sc = screen(l.c)
    if (sc.choices && !sc.result && step.key) {
      for (const k of step.key) l.go({ choose: k + 1 })
      continue
    }
    if (sc.input && !sc.result) { l.go({ text: 'x' }); continue }
    const main = sc.actions.find(a => a.primary) ?? sc.actions.find(a => a.id !== 'ask')
    if (!main) return `no button on "${sc.title}"`
    const out = l.go({ action: main.id })
    if (!did(out)) return `"${main.label}" does nothing on "${sc.title}"`
    if (out.effects.some(fx => fx.kind === 'check') && step.check) l.take(checked(l.c, step.id, step.check.probes.map(p => ({ id: p.id, ok: true, got: '' }))))
    if (where(l.c) !== from) return undefined
  }
  return `still on "${step.title}" after ${MAX_PRESSES} presses`
}

// Every button on the step's first screen does something: a press changes the log or asks the host for work
function deadButtons(l: ReturnType<typeof at>): string[] {
  const sc = screen(l.c)
  return sc.actions.filter(a => !did(press(l.c, { action: a.id }))).map(a => `"${a.label}" does nothing on "${sc.title}"`)
}

// Shapes an author might write: the step with parts of it left out. Only the ones the schema accepts must work.
function variants(step: Step): Step[] {
  const out: Step[] = [step]
  if (step.choices) { const { choices: _c, key: _k, ...rest } = step; out.push(rest as Step) }
  if (step.hints) { const { hints: _h, ...rest } = step; out.push(rest as Step) }
  if (step.frames) { const { frames: _f, ...rest } = step; out.push(rest as Step) }
  if (step.code && !step.code.run && step.choices) out.push({ ...step, code: { ...step.code, run: { file: 'main', argv: ['run'], out: 'out' } } })
  return out
}

function everyStep(fn: (lib: (typeof LIBRARY)[number], seg: Segment, i: number, step: Step) => void) {
  for (const lib of LIBRARY) for (const seg of lib.segments) seg.steps.forEach((step, i) => fn(lib, seg, i, step))
}

test('every built-in step can be left by a learner who knows the answer, and no button on it is dead', () => {
  const stuck: string[] = []
  everyStep((lib, seg, i, step) => {
    if (step.drill) return
    const why = leave(at(lib.course, lib.segments, seg, i), step) ?? deadButtons(at(lib.course, lib.segments, seg, i))[0]
    if (why) stuck.push(`${seg.id}/${step.id}: ${why}`)
  })
  expect(stuck).toEqual([])
})

test('a step the schema accepts can always be left, whatever parts the author left out (#15)', () => {
  const stuck: string[] = []
  everyStep((lib, seg, i, step) => {
    if (step.drill) return
    for (const v of variants(step).slice(1)) {
      const g = { ...seg, steps: seg.steps.map((x, j) => (j === i ? v : x)) }
      if (validateSegment(g, lib.course).length) continue
      const why = leave(at(lib.course, lib.segments, g, i), v) ?? deadButtons(at(lib.course, lib.segments, g, i))[0]
      if (why) stuck.push(`${seg.id}/${step.id} (${Object.keys(step).filter(k => !(k in v)).join(', ') || 'changed'}): ${why}`)
    }
  })
  expect(stuck).toEqual([])
})

// What a learner has put into a step: leaving it and coming back must give all of it back
const kept = (c: Ctx, id: string) => JSON.stringify([current(c)?.step.id, ...(['result', 'draft', 'frame', 'hints', 'solved', 'idk'] as const).map(k => c.state[k][id])])

// Half way through a step: one cell of a sequence, a wrong answer, a later frame, a failed check
function midway(l: ReturnType<typeof at>, step: Step) {
  if (step.choices && step.key && (step.kind === 'reorder' || step.kind === 'trace')) l.go({ choose: step.key[0]! + 1 })
  else if (step.choices && step.key) l.go({ choose: step.choices.findIndex((_, i) => !step.key!.includes(i)) + 1 || 1 })
  if (step.frames) l.go({ action: 'frame-next' })
  if (step.check) l.take(checked(l.c, step.id, step.check.probes.map(p => ({ id: p.id, ok: false, got: '' }))))
}

// The ways out of a step that must lead back to it: Ask, the Path, and a new session's welcome
const ROUND_TRIPS: Record<string, (l: ReturnType<typeof at>) => void> = {
  'Ask, then back': l => { l.go({ action: 'ask' }); l.go({ action: 'back' }) },
  'Path, then Continue': l => { l.go({ action: 'curriculum' }); l.go({ action: 'start' }) },
  'a new session, then Continue': l => {
    l.c.welcome = true
    l.go({ action: 'continue' })
    l.c.welcome = false
    for (let i = 0; i < 10 && current(l.c)?.warm; i++) l.go({ action: 'skip' })
  },
}

test('no way out of a step loses what the learner put into it (#lost-exam)', () => {
  const lost: string[] = []
  everyStep((lib, seg, i, step) => {
    if (step.drill) return
    for (const [name, trip] of Object.entries(ROUND_TRIPS)) {
      const l = at(lib.course, lib.segments, seg, i)
      midway(l, step)
      const before = kept(l.c, step.id)
      trip(l)
      if (kept(l.c, step.id) !== before) lost.push(`${seg.id}/${step.id} after ${name}: ${before} → ${kept(l.c, step.id)}`)
    }
  })
  expect(lost).toEqual([])
})

test('a new session resumes the check before the next lesson as it was left, answers kept (#lost-exam)', () => {
  const seg = bigo.bigo1
  const trace = seg.steps.findIndex(x => x.kind === 'trace')
  const l = at(bigo.course, bigo.segments, seg, trace)
  const step = seg.steps[trace]!
  for (const k of step.key!) l.go({ choose: k === step.key![0] ? ((k + 1) % step.choices!.length) + 1 : k + 1 })
  const last = seg.steps.findLastIndex(x => !x.drill)
  l.take({ events: [{ ts: l.c.now, type: 'enter', seg: seg.id, step: last }], effects: [] })
  l.c.state = { ...l.c.state, solved: { ...l.c.state.solved, [seg.steps[last]!.id]: true }, result: { ...l.c.state.result, [seg.steps[last]!.id]: { tone: 'right', text: '' } } }
  l.go({ action: 'next' })
  expect(screen(l.c).progress?.label).toMatch(/^Before you move on · 1 of/)
  l.go({ choose: 1 })
  const check = JSON.stringify([l.c.state.warm, screen(l.c).progress, screen(l.c).choices, screen(l.c).result, screen(l.c).actions])
  l.c.welcome = true
  expect(screen(l.c).body).toMatch(/You stopped at: \*\*Before you move on\*\* · 1 of/)
  l.go({ action: 'continue' })
  l.c.welcome = false
  expect(JSON.stringify([l.c.state.warm, screen(l.c).progress, screen(l.c).choices, screen(l.c).result, screen(l.c).actions])).toBe(check)
})

test('the check before the next lesson can be left for the path, and Continue there returns to it as it was', () => {
  const seg = bigo.bigo1
  const trace = seg.steps.findIndex(x => x.kind === 'trace')
  const l = at(bigo.course, bigo.segments, seg, trace)
  const step = seg.steps[trace]!
  for (const k of step.key!) l.go({ choose: k === step.key![0] ? ((k + 1) % step.choices!.length) + 1 : k + 1 })
  const last = seg.steps.findLastIndex(x => !x.drill)
  l.take({ events: [{ ts: l.c.now, type: 'enter', seg: seg.id, step: last }], effects: [] })
  l.c.state = { ...l.c.state, solved: { ...l.c.state.solved, [seg.steps[last]!.id]: true }, result: { ...l.c.state.result, [seg.steps[last]!.id]: { tone: 'right', text: '' } } }
  l.go({ action: 'next' })
  l.go({ choose: 1 })
  expect(screen(l.c).progress?.action).toBe('curriculum')
  const check = JSON.stringify([l.c.state.warm, screen(l.c)])
  l.go({ action: 'curriculum' })
  expect(screen(l.c).kind).toBe('curriculum')
  l.go({ action: 'start' })
  expect(JSON.stringify([l.c.state.warm, screen(l.c)])).toBe(check)
})

test('the host handles every effect the engine asks for (#14)', () => {
  const asked = new Set<string>()
  everyStep((lib, seg, i, step) => {
    const l = at(lib.course, lib.segments, seg, i)
    for (const a of screen(l.c).actions) press(l.c, { action: a.id }).effects.forEach(fx => asked.add(fx.kind))
    leave(l, step)
    l.effects.forEach(k => asked.add(k))
  })
  const handled = new Set<string>(HANDLED_EFFECTS)
  expect([...asked].filter(k => !handled.has(k))).toEqual([])
})
