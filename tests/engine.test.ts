import { expect, test } from 'claude-code/testing'

import * as git from '../courses/git'
import { apply, checked, current, initial, press, replay, screen, snapshot, taught } from '../hooks/engine/engine'
import type { Ctx, Out } from '../hooks/engine/engine'
import { skillState } from '../hooks/engine/mastery'
import { stats } from '../hooks/engine/stats'
import { validateCourse, validateSegment } from '../hooks/engine/schema'
import type { LogEvent, Press } from '../hooks/engine/types'

const T0 = Date.parse('2026-10-27T10:00:00Z')

function learner() {
  const log: LogEvent[] = []
  const effects: Out['effects'] = []
  const c: Ctx = { state: initial(), course: git.course, segments: { 'branches-1': git.branches1 }, now: T0 }
  const take = (out: Out) => {
    for (const e of out.events) { c.state = apply(c.state, e); log.push(e) }
    effects.push(...out.effects)
    c.now += 1000
    return out
  }
  const go = (p: Press) => take(press(c, p))
  const pass = () => take(checked(c, current(c)!.step.id, current(c)!.step.check!.probes.map(p => ({ id: p.id, ok: true, got: '' }))))
  const toLesson = () => {
    take({ events: [{ ts: c.now, type: 'course', course: 'git' }], effects: [] })
    go({ choose: 2 }); go({ choose: 2 }); go({ choose: 1 })
    take({ events: git.course.setup.map(r => ({ ts: c.now, type: 'setup' as const, req: r.id, status: 'ok' as const })), effects: [] })
    go({ action: 'continue' })
    go({ action: 'start' })
  }
  return { c, log, effects, go, take, pass, toLesson, step: () => current(c)!.step.id }
}

test('the shipped Git course and its first segment are valid', () => {
  expect(validateCourse(git.course)).toEqual([])
  expect(validateSegment(git.branches1, git.course)).toEqual([])
  expect(validateSegment({ ...git.branches1, steps: [{ ...git.branches1.steps[1]!, key: [9] }] }, git.course).join('\n')).toMatch(/key must name/)
  expect(validateSegment({ ...git.branches1, steps: git.branches1.steps.filter(x => x.skill !== 'branch-from') }, git.course)).toContain('skill branch-from has no graded step in this segment')
  expect(validateSegment({ ...git.branches1, practice: { adapter: 'git', dir: '../x', scaffold: [] } }, git.course)).toContain('practice.dir must be a relative path inside the course folder')
})

test('intake, setup and curriculum take one click each, then the first step and its practice repo', () => {
  const l = learner()
  l.take({ events: [{ ts: l.c.now, type: 'course', course: 'git' }], effects: [] })
  expect(screen(l.c).kind).toBe('intake')
  expect(screen(l.c).choices?.length).toBe(3)
  l.go({ choose: 2 }); l.go({ choose: 2 })
  expect(screen(l.c).progress?.label).toBe('3 of 3')
  l.go({ choose: 1 })
  expect(l.c.state.stage).toBe('setup')
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['setup'])
  expect(l.go({ action: 'continue' }).events).toEqual([])
  expect(l.go({ action: 'setup' }).effects).toEqual([{ kind: 'setup' }])
  l.take({ events: git.course.setup.map(r => ({ ts: l.c.now, type: 'setup' as const, req: r.id, status: 'ok' as const })), effects: [] })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['continue'])
  l.go({ action: 'continue' })
  expect(screen(l.c).kind).toBe('curriculum')
  const started = l.go({ action: 'start' })
  expect(started.effects).toContainEqual({ kind: 'practice', dir: 'practice/git-branches' })
  expect(l.step()).toBe('b1')
  expect(screen(l.c).compare?.stops).toMatch(/never moves by itself/)
})

test('a question grades instantly with the reason, and an anticipated wrong answer names its misconception', () => {
  const l = learner()
  l.toLesson()
  expect(l.go({ action: 'next' }).events[0]).toMatchObject({ type: 'enter', step: 1 })
  expect(screen(l.c).kind).toBe('question')
  expect(l.go({ action: 'next' }).events).toEqual([])
  const out = l.go({ choose: 1 })
  expect(out.events[0]).toMatchObject({ type: 'answer', verdict: 'wrong', class: 'misconception', tag: 'head-stays' })
  const sc = screen(l.c)
  expect(sc.result).toEqual({ tone: 'wrong', text: 'switch -c does two things: it creates feature, then moves HEAD onto it.' })
  expect(sc.choices?.map(c => c.mark)).toEqual(['wrong', 'key', undefined, undefined])
  expect(l.go({ choose: 2 }).events).toEqual([])
  expect(sc.actions[0]).toMatchObject({ id: 'next', label: 'Practice this' })
  l.go({ action: 'next' })
  expect(l.step()).toBe('b2d')
  l.go({ choose: 1 })
  expect(l.c.state.weak['head-stays']).toMatchObject({ status: 'recheck', count: 1 })
  l.go({ action: 'next' }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
})

const DAY = 86_400_000
const toB3 = (l: ReturnType<typeof learner>) => { l.toLesson(); l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' }) }
const onMain = [{ id: 'exists', ok: true, got: 'abc' }, { id: 'on-branch', ok: false, got: 'main' }]

test('failing the same idea twice gives a new angle, at most two drills, then the learner may move on', () => {
  const l = learner()
  toB3(l)
  l.take(checked(l.c, 'b3', onMain))
  l.go({ action: 'next' })
  expect(l.step()).toBe('b3d')
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
  l.take(checked(l.c, 'b3', onMain))
  l.go({ action: 'next' })
  expect(l.step()).toBe('b3e')
  expect(screen(l.c).code?.source).toMatch(/git branch topic/)
  l.go({ choose: 1 }); l.go({ action: 'next' })
  const third = l.take(checked(l.c, 'b3', onMain))
  expect(third.events[0]).not.toHaveProperty('branch')
  expect(third.effects).toEqual([])
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'hint', 'skip', 'ask'])
  l.go({ action: 'skip' })
  expect(l.step()).toBe('b4')
  expect(l.c.state.weak['branch-not-switch']).toMatchObject({ count: 3, status: 'open' })
  expect(replay(l.log)).toEqual(l.c.state)
})

test('a miss on a drill gives the other angle, then returns to the task, not to the first drill', () => {
  const l = learner()
  toB3(l)
  l.take(checked(l.c, 'b3', onMain))
  l.go({ action: 'next' })
  l.go({ choose: 2 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3e')
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
  expect(l.c.state.drills).toEqual({ b3: 2 })
  expect(replay(l.log)).toEqual(l.c.state)
})

test('a drill with no fresh angle left asks the author for one', () => {
  const l = learner()
  toB3(l)
  const s = l.c.state
  l.c.state = { ...s, weak: { 'branch-not-switch': { key: 'branch-not-switch', tag: 'branch-not-switch', skill: 'branch-switch', cls: 'misconception', count: 2, status: 'open', steps: ['b3'], used: ['branches-1/4', 'branches-1/5'], last: T0 } } }
  const out = l.take(checked(l.c, 'b3', onMain))
  expect(out.effects).toEqual([{ kind: 'remedy', tag: 'branch-not-switch', skill: 'branch-switch' }])
})

test('a fixed weakness comes back in the next warm-up and is resolved only by a re-check a day later', () => {
  const l = learner()
  toB3(l)
  l.take(checked(l.c, 'b3', onMain))
  l.go({ action: 'next' }); l.go({ choose: 1 }); l.go({ action: 'next' })
  l.pass()
  const w = l.c.state.weak['branch-not-switch']!
  expect(w.status).toBe('recheck')
  expect(w.due).toBeGreaterThanOrEqual(l.c.now + DAY - 5000)
  l.c.welcome = true
  expect(screen(l.c).body).not.toMatch(/keep sharp/)

  const next: Ctx = { state: replay(l.log), course: git.course, segments: { 'branches-1': git.branches1 }, now: w.due! + 60_000, welcome: true }
  expect(next.state.pos).toEqual(l.c.state.pos)
  expect(screen(next).body).toMatch(/First, 2 things to keep sharp\./)
  const warm = press(next, { action: 'continue' })
  expect(warm.events[0]).toMatchObject({ type: 'warm', items: [{ step: 'b3e', key: 'branch-not-switch' }, { step: 'b2d', key: 'skill:branch-model' }] })
  const run = (p: Press) => { const out = press(next, p); for (const e of out.events) next.state = apply(next.state, e); return out }
  for (const e of warm.events) next.state = apply(next.state, e)
  next.welcome = false
  expect(screen(next).progress?.label).toBe('Warm-up · 1 of 2')
  expect(run({ choose: 1 }).events[0]).toMatchObject({ verdict: 'right', review: 'branch-not-switch', rk: 'warm1:b3e' })
  expect(next.state.weak['branch-not-switch']?.status).toBe('resolved')
  run({ action: 'next' })
  expect(screen(next).progress?.label).toBe('Warm-up · 2 of 2')
  expect(screen(next).choices?.some(c => c.mark)).toBe(false)
  run({ choose: 1 })
  expect(screen(next).actions[0]).toMatchObject({ id: 'next', label: 'Back to your lesson' })
  run({ action: 'next' })
  expect(current(next)?.step.id).toBe(current(l.c)?.step.id)
  expect(screen(next).kind).toBe('exercise')
})

test('a re-check failed in the warm-up reopens the weakness', () => {
  const l = learner()
  toB3(l)
  l.take(checked(l.c, 'b3', onMain))
  l.go({ action: 'next' }); l.go({ choose: 1 }); l.go({ action: 'next' })
  l.pass()
  l.c.now = l.c.state.weak['branch-not-switch']!.due! + 1
  l.c.welcome = true
  l.go({ action: 'continue' })
  l.c.welcome = false
  l.go({ choose: 2 })
  expect(l.c.state.weak['branch-not-switch']).toMatchObject({ status: 'open', count: 2 })
})

test('hints wait for a real attempt, an anticipated miss branches to a drill and comes back', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
  expect(l.go({ action: 'hint' }).events).toEqual([])
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'ask'])
  expect(l.go({ action: 'check' }).effects).toEqual([{ kind: 'check', step: 'b3' }])
  l.take(checked(l.c, 'b3', [{ id: 'exists', ok: true, got: 'abc' }, { id: 'on-branch', ok: false, got: 'main' }]))
  expect(screen(l.c).result?.text).toMatch(/still on main/)
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'next', 'hint', 'ask'])
  l.go({ action: 'hint' })
  expect(screen(l.c).hint).toEqual({ level: 1, text: 'One command can create a branch and move you onto it.' })
  l.go({ action: 'next' })
  expect(l.step()).toBe('b3d')
  expect(screen(l.c).progress?.label).toBe('Branches · practice')
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
  l.pass()
  expect(screen(l.c).result?.tone).toBe('right')
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['next'])
  l.go({ action: 'next' })
  expect(l.step()).toBe('b4')
  expect(l.c.state.evidence.filter(e => e.step === 'b3').map(e => [e.ok, e.hints])).toEqual([[false, 0], [true, 1]])
})

test('a miss the script did not anticipate waits for the teacher, then shows its diagnosis in place', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' })
  const out = l.take(checked(l.c, 'b3', [{ id: 'exists', ok: true, got: 'abc' }, { id: 'on-branch', ok: false, got: 'feature-login' }]))
  expect(out.effects).toEqual([{ kind: 'escalate', esc: 'b3#1', step: 'b3', probe: 'on-branch', got: 'feature-login' }])
  expect(screen(l.c).result).toEqual({ tone: 'wait', text: 'Looking at your answer… The check found "feature-login" where the task expects "feature/login".' })
  expect(l.go({ action: 'check' }).effects).toEqual([])
  expect(taught(l.c, 'b2#1', { class: 'misread', feedback: 'x' }).events).toEqual([])
  l.take(taught(l.c, 'b3#1', { class: 'misread', feedback: 'You are on feature-login: the task asks for feature/login, with a slash.' }))
  expect(screen(l.c).result).toEqual({ tone: 'wrong', text: 'You are on feature-login: the task asks for feature/login, with a slash.' })
  expect(l.c.state.mistakes.at(-1)).toMatchObject({ step: 'b3', class: 'misread', skill: 'branch-switch' })
})

test('the log replays to the same state; a transfer task solved alone proves the skill', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' })
  l.pass(); l.go({ action: 'next' })
  l.pass(); l.go({ action: 'next' })
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b6')
  l.pass()
  expect(skillState(l.c.state, 'branch-from', l.c.now)).toBe('demonstrated')
  expect(skillState(l.c.state, 'branch-switch', l.c.now)).toBe('learning')
  expect(replay(l.log)).toEqual(l.c.state)
  l.go({ action: 'next' })
  expect(l.c.state.stage).toBe('recap')
  expect(l.effects).toContainEqual({ kind: 'prepare', after: 'branches-1' })
  expect(snapshot(l.c)).toMatch(/Stage: recap/)
})

test('a miss after two right answers on the same skill is a slip: no drill', () => {
  const l = learner()
  l.toLesson()
  const s = l.c.state
  l.c.state = { ...s, evidence: [...s.evidence, ...[1, 2].map(i => ({ skill: 'branch-switch', ts: T0 - i, ok: true, difficulty: 1, hints: 0, unseen: false, step: `x${i}` }))] }
  l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' })
  const out = l.take(checked(l.c, 'b3', [{ id: 'exists', ok: true, got: '' }, { id: 'on-branch', ok: false, got: 'main' }]))
  expect(out.events[0]).toMatchObject({ class: 'slip' })
  expect(out.events[0]).not.toHaveProperty('branch')
})

test('a side question keeps the place; the engine answers a press in well under a millisecond', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'ask' })
  expect(screen(l.c).actions).toEqual([{ id: 'back', label: 'Back to step', primary: true, key: 'b' }])
  l.go({ action: 'back' })
  expect(l.step()).toBe('b1')
  expect(screen(l.c).actions[0]?.id).toBe('next')

  const n = 2000
  const t0 = performance.now()
  for (let i = 0; i < n; i++) { const c = { ...l.c }; press(c, { action: 'next' }); screen(c) }
  const perPress = (performance.now() - t0) / n
  expect(perPress).toBeLessThan(1)
})

test('asking for help during a transfer task means passing it no longer proves the skill', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' }); l.go({ choose: 2 }); l.go({ action: 'next' })
  l.pass(); l.go({ action: 'next' })
  l.pass(); l.go({ action: 'next' })
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b6')
  expect(snapshot(l.c)).toMatch(/not solved this step yet \(a transfer task that proves the skill\)/)
  l.go({ action: 'ask' }); l.go({ action: 'back' })
  l.pass()
  expect(skillState(l.c.state, 'branch-from', l.c.now)).toBe('practiced')
  expect(replay(l.log)).toEqual(l.c.state)
})

test('progress is read from the answers: accuracy, first try, time, the curve, strengths and weaknesses', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' })
  l.go({ choose: 1 })
  l.go({ action: 'next' })
  l.go({ choose: 1 })
  const st = stats(git.course, l.c.state, l.c.now)
  expect(st).toMatchObject({ answers: 2, accuracy: 0.5, firstTry: 0.5, hintsPerAnswer: 0, days: 1, streak: 1, curve: [0, 0.5], mistakes: { misconception: 1 } })
  expect(st.medianSecs).toBeGreaterThan(0)
  expect(st.weaknesses).toEqual([{ text: expect.stringMatching(/^The idea that /), detail: '1× wrong · fixed once, re-checked later' }])
  const sc = screen({ ...l.c, progress: true })
  expect(sc).toMatchObject({ kind: 'progress', title: 'Your progress', chart: { points: [0, 0.5] }, actions: [{ id: 'back' }] })
  expect(sc.tiles?.slice(0, 3)).toEqual([{ label: 'right', value: '50%' }, { label: 'right first try', value: '50%' }, { label: 'answers', value: '2' }])
  expect(sc.groups?.map(g => g.title)).toEqual(['Strengths', 'To work on', 'Skills'])
  expect(screen({ ...learner().c, progress: true }).body).toMatch(/^No answers yet/)
})
