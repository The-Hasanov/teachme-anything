import { expect, test } from 'claude-code/testing'

import * as git from './fixtures/git'
import { apply, checked, current, dashboard, initial, lookBack, press, replay, screen, snapshot, taught, withProject, level } from '../hooks/engine/engine'
import type { Ctx, Out } from '../hooks/engine/engine'
import { skillState } from '../hooks/engine/mastery'
import { stats } from '../hooks/engine/stats'
import { replanErrors, untaught, validateCourse, validateReading, validateSegment } from '../hooks/engine/schema'
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
  // Nothing to wait for here: the learner clicks Install everything
  l.take({ events: [{ ts: l.c.now, type: 'setup', req: git.course.setup[0]!.id, status: 'missing' }], effects: [] })
  expect(screen(l.c).result).toEqual({ tone: 'info', text: 'Teach Me installs and sets up what is missing for you.' })
  l.take({ events: git.course.setup.map(r => ({ ts: l.c.now, type: 'setup' as const, req: r.id, status: 'ok' as const })), effects: [] })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['continue'])
  l.go({ action: 'continue' })
  expect(screen(l.c).kind).toBe('curriculum')
  const started = l.go({ action: 'start' })
  expect(started.effects).toContainEqual({ kind: 'practice', dir: 'practice/git-branches', seg: 'branches-1' })
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
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'hint', 'skip', 'prev', 'ask', 'explore'])
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
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'prev', 'ask', 'explore'])
  expect(l.go({ action: 'check' }).effects).toEqual([{ kind: 'check', step: 'b3' }])
  l.take(checked(l.c, 'b3', [{ id: 'exists', ok: true, got: 'abc' }, { id: 'on-branch', ok: false, got: 'main' }]))
  expect(screen(l.c).result?.text).toMatch(/still on main/)
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['check', 'next', 'hint', 'prev', 'ask', 'explore'])
  l.go({ action: 'hint' })
  expect(screen(l.c).hint).toEqual({ level: 1, text: 'One command can create a branch and move you onto it.' })
  l.go({ action: 'next' })
  expect(l.step()).toBe('b3d')
  expect(screen(l.c).progress?.label).toBe('Branches · practice')
  l.go({ choose: 1 }); l.go({ action: 'next' })
  expect(l.step()).toBe('b3')
  l.pass()
  expect(screen(l.c).result?.tone).toBe('right')
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['next', 'prev'])
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
  expect(screen(l.c).actions.map(a => `${a.id}:${a.label}`)).toEqual(['back:Hide the explanation', 'next:Next', 'explore:Explore'])
  l.go({ action: 'back' })
  expect(l.step()).toBe('b1')
  expect(screen(l.c).actions[0]?.id).toBe('next')
  // On a question the explanation opens under it: the choices stay, and an answer closes the explanation (#lost-exam)
  l.go({ action: 'next' })
  const question = screen(l.c)
  l.go({ action: 'ask' })
  expect(screen(l.c)).toMatchObject({ kind: 'question', choices: question.choices, result: { tone: 'info' } })
  l.go({ choose: 1 })
  expect(l.c.state.aside).toBe(false)
  expect(screen(l.c).result?.tone).not.toBe('info')
  l.go({ action: 'back' })

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
  expect(sc).toMatchObject({ kind: 'progress', title: 'Your progress', actions: [{ id: 'back' }] })
  expect(sc.tiles?.slice(0, 3)).toEqual([{ label: 'right', value: '50%' }, { label: 'right first try', value: '50%' }, { label: 'answers', value: '2' }])
  // Two points would draw a steep fall; the curve waits for five answers
  expect(sc.chart).toBeUndefined()
  expect(sc.groups?.map(g => g.title)).toEqual(['Learning curve', 'Strengths', 'To work on', 'Skills'])
  expect(sc.groups?.[0]?.lines).toEqual([{ mark: 'todo', text: 'Your curve appears after 5 answers' }])
  // A skill being learned has its own half mark, and counts half in the bar while the label stays whole
  const learning = git.course.skills.filter(k => skillState(l.c.state, k.id, l.c.now) === 'learning')
  expect(learning.length).toBeGreaterThan(0)
  expect(sc.groups?.[3]?.lines.filter(x => x.mark === 'half').map(x => x.text)).toEqual(learning.map(k => k.title))
  expect(sc.progress).toEqual({ label: `0 of ${git.course.skills.length} skills · ${learning.length} learning`, done: learning.length / 2, total: git.course.skills.length })
  expect(screen({ ...learner().c, progress: true }).body).toMatch(/^No answers yet/)
})

test('after a finished segment, Continue goes to the next one or waits for it, never back to the old last step', () => {
  const l = learner()
  l.toLesson()
  l.take({ events: [{ ts: l.c.now, type: 'enter', seg: 'branches-1', step: git.branches1.steps.length - 1 }, { ts: l.c.now, type: 'stage', stage: 'recap' }], effects: [] })
  expect(screen(l.c).result).toMatchObject({ tone: 'info', text: expect.stringMatching(/not written yet/) })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['retry', 'curriculum', 'progress', 'explore'])
  expect(l.go({ action: 'retry' }).effects).toEqual([{ kind: 'prepare', after: 'branches-1' }])
  l.go({ action: 'curriculum' })
  expect(l.go({ action: 'start' }).events).toEqual([])
  l.c.preparing = true
  expect(screen(l.c)).toMatchObject({ kind: 'curriculum', result: { tone: 'wait' } })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['progress', 'explore'])
  l.c.segments['merge-1'] = { ...git.branches1, id: 'merge-1' }
  l.c.preparing = false
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['start', 'progress', 'explore'])
  l.go({ action: 'start' })
  expect(l.c.state).toMatchObject({ stage: 'lesson', pos: { seg: 'merge-1', step: 0 } })
  expect(l.c.state.done).toBeUndefined()
})

test('#11 #12 the next lesson shows seconds while written, says when it is slow, and says why it failed', () => {
  const l = learner()
  l.toLesson()
  l.take({ events: [{ ts: l.c.now, type: 'enter', seg: 'branches-1', step: git.branches1.steps.length - 1 }, { ts: l.c.now, type: 'stage', stage: 'recap' }], effects: [] })
  Object.assign(l.c, { preparing: true, prepSince: l.c.now - 42_000 })
  expect(screen(l.c).result).toEqual({ tone: 'wait', text: expect.stringMatching(/being written and checked\. About a minute\. 42s so far\.$/) })
  l.c.prepSince = l.c.now - 200_000
  expect(screen(l.c).result?.text).toMatch(/200s so far\. Taking longer than usual/)
  Object.assign(l.c, { preparing: false, prepSince: undefined, prepError: 'b3: probe tests fails on the reference solution (got "cargo: command not found")' })
  expect(screen(l.c).result).toEqual({ tone: 'wrong', text: 'Your next lesson could not be written: b3: probe tests fails on the reference solution (got "cargo: command not found")' })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['retry', 'curriculum', 'progress', 'explore'])
})

test('#18 a lesson whose segment is missing says why and offers Write it now, which prepares that segment', () => {
  const l = learner()
  l.toLesson()
  delete l.c.segments['branches-1']
  expect(screen(l.c)).toMatchObject({ kind: 'empty', result: { tone: 'info', text: 'Your lesson is not written yet.' } })
  l.c.prepError = 'the author stopped without submitting it and gave no reason'
  expect(screen(l.c).result).toEqual({ tone: 'wrong', text: 'Your lesson could not be written: the author stopped without submitting it and gave no reason' })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['retry', 'progress', 'explore'])
  expect(press(l.c, { action: 'retry' }).effects).toEqual([{ kind: 'prepare', after: '', seg: 'branches-1' }])
  Object.assign(l.c, { preparing: true, prepSince: l.c.now - 5_000, prepError: undefined })
  expect(screen(l.c)).toMatchObject({ actions: [], result: { tone: 'wait', text: expect.stringMatching(/5s so far\.$/) } })
  expect(press(l.c, { action: 'retry' }).effects).toEqual([])
})

test('Path lists the lessons of the section under way, the current one with its step, and Continue returns to it', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' })
  const at = l.step()
  l.go({ action: 'curriculum' })
  const lines = screen(l.c).lines!
  const phase = git.course.phases.find(p => p.segments.includes('branches-1'))!
  expect(lines.filter(x => !x.sub)).toHaveLength(git.course.phases.length)
  expect(lines.filter(x => x.sub)).toHaveLength(phase.segments.length)
  expect(lines.find(x => x.sub && x.mark === 'now')).toMatchObject({ text: git.branches1.title, detail: `2 of ${git.branches1.steps.filter(x => !x.drill).length} steps` })
  l.go({ action: 'start' })
  expect(l.step()).toBe(at)
})

test('Previous looks back at earlier steps read-only, answers marked, never past where the learner is; Back returns', () => {
  const l = learner()
  l.toLesson()
  const q = git.branches1.steps[1]!
  l.go({ action: 'next' })
  l.go({ choose: q.key![0]! + 1 })
  l.go({ action: 'next' })
  const at = l.step()
  const kept = JSON.stringify(l.c.state)
  const out = l.go({ action: 'prev' })
  expect(out.effects).toEqual([{ kind: 'peek', seg: 'branches-1', step: 1 }])
  l.c.peek = { seg: 'branches-1', step: 1 }
  const sc = screen(l.c)
  expect(sc.progress?.label).toMatch(/· 2 of \d+ · looking back$/)
  expect(sc.choices?.find(ch => ch.n === q.key![0]! + 1)?.mark).toBe('right')
  expect(sc.actions.map(a => `${a.id}:${a.label}`)).toEqual([`back:Back to ${current(l.c)!.step.title}`, 'prev:Previous step'])
  // Next step stops before the step under way: that one is Back
  expect(lookBack(l.c, 'branches-1', 1, 1)).toBeUndefined()
  expect(lookBack(l.c, 'branches-1', 1, -1)).toBe(0)
  expect(JSON.stringify(l.c.state)).toBe(kept)
  l.c.peek = undefined
  expect(l.step()).toBe(at)
})

test('Path opens a finished lesson read-only from its first step; Back goes to the path', () => {
  const l = learner()
  l.toLesson()
  l.take({ events: [{ ts: l.c.now, type: 'stage', stage: 'recap' }, { ts: l.c.now, type: 'stage', stage: 'curriculum' }], effects: [] })
  const line = screen(l.c).lines!.find(x => x.sub && x.text === git.branches1.title)!
  expect(line).toMatchObject({ mark: 'ok', action: 'open:branches-1' })
  expect(l.go({ action: line.action! }).effects).toEqual([{ kind: 'peek', seg: 'branches-1', step: 0 }])
  l.c.peek = { seg: 'branches-1', step: 0 }
  expect(screen(l.c).actions.map(a => `${a.id}:${a.label}`)).toEqual(['back:Back to your path', 'peek-next:Next step'])
  expect(lookBack(l.c, 'branches-1', 0, 1)).toBe(1)
  // Only a finished lesson opens; one not written yet does nothing
  expect(l.go({ action: 'open:merge-1' }).effects).toEqual([])
})

test('Path lists every reading written here, each one tap from opening; studied lessons and readings stay reachable', () => {
  const l = learner()
  l.toLesson()
  l.c.readings = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, topic: `Topic ${i}`, read: i % 3, total: 2 }))
  l.go({ action: 'curriculum' })
  const g = screen(l.c).groups!.find(x => x.title === 'Your readings')!
  expect(g.lines).toHaveLength(10)
  expect(g.lines.slice(0, 3).map(x => `${x.mark}:${x.detail}`)).toEqual(['todo:0 of 2 sections read', 'half:1 of 2 sections read', 'ok:2 of 2 sections read'])
  expect(l.go({ action: g.lines[9]!.action! }).effects).toEqual([{ kind: 'explore', topic: 'Topic 9' }])
  expect(l.go({ action: 'read:nope' }).effects).toEqual([])
})

test('the dashboard path: lessons done, the current one with its step, the next one being written or failed', () => {
  const l = learner()
  l.toLesson()
  const steps = git.branches1.steps.filter(x => !x.drill).length
  expect(dashboard(l.c)).toEqual({
    title: git.course.subject, goal: git.course.goal,
    overall: { label: `Lesson 1 of 2 · 1 of ${steps} steps`, done: 0, total: 2 },
    phases: [
      { id: 'branches', title: 'Branches', mark: 'now', done: 0, total: 1, lessons: [{ id: 'branches-1', title: 'Branches', status: 'now', steps: `1 of ${steps} steps` }] },
      { id: 'merging', title: 'Merging', mark: 'todo', done: 0, total: 1, lessons: [{ id: git.course.phases[1]!.segments[0], title: 'Not written yet', status: 'todo' }] },
    ],
  })
  // Steps into the lesson move its phase bar and the overall share before the lesson is done
  l.go({ action: 'next' })
  expect(dashboard(l.c)?.overall).toEqual({ label: `Lesson 1 of 2 · 2 of ${steps} steps`, done: 1 / steps, total: 2 })
  expect(dashboard(l.c)?.phases.map(p => [p.done, p.progress])).toEqual([[0, 1 / steps], [0, undefined]])
  l.take({ events: [{ ts: l.c.now, type: 'stage', stage: 'recap' }], effects: [] })
  l.c.preparing = true
  expect(dashboard(l.c)?.phases.map(p => [p.mark, p.lessons[0]!.status])).toEqual([['ok', 'done'], ['now', 'writing']])
  expect(dashboard(l.c)?.overall).toEqual({ label: '1 of 2 lessons', done: 1, total: 2 })
  Object.assign(l.c, { preparing: false, prepError: 'cargo check failed' })
  expect(dashboard(l.c)?.phases[1]?.lessons[0]?.status).toBe('failed')
})

test('reset a section: its answers, hints and reviews are cleared, the learner starts it again, practice is rewritten', () => {
  const l = learner()
  l.toLesson()
  const step = l.step()
  expect(press(l.c, { action: 'reset:merging' }).events[0]).toMatchObject({ type: 'reset', segs: ['merge-1'], rewind: false })
  l.take({ events: [
    { ts: l.c.now, type: 'hint', step, level: 1 },
    { ts: l.c.now, type: 'migrated', skill: 'branch-model', state: 'practiced', evidence: 'x', date: '2026-01-01' },
    { ts: l.c.now, type: 'stage', stage: 'recap' },
  ], effects: [] })
  expect([l.c.state.hints[step], l.c.state.done, l.c.state.migrated.length]).toEqual([1, 'branches-1', 1])

  const out = l.go({ action: 'reset:branches' })
  expect(out.events[0]).toMatchObject({ type: 'reset', segs: ['branches-1'], skills: ['branch-model', 'branch-switch', 'branch-commit', 'branch-from'], rewind: true })
  expect(out.effects).toEqual([{ kind: 'restart', segs: ['branches-1'] }])
  expect(l.c.state).toMatchObject({ stage: 'curriculum', pos: undefined, done: undefined, hints: {}, migrated: [] })
  expect(replay(l.log)).toEqual(l.c.state)
  expect(screen(l.c).actions.map(a => a.id)).toContain('start')
  l.go({ action: 'start' })
  expect(current(l.c)?.seg.id).toBe('branches-1')
})

test('reset the whole course clears every section; a reset before setup is ignored', () => {
  const l = learner()
  expect(press(l.c, { action: 'reset' })).toEqual({ events: [], effects: [] })
  l.toLesson()
  const out = l.go({ action: 'reset' })
  expect(out.events[0]).toMatchObject({ type: 'reset', segs: ['branches-1', 'merge-1'], rewind: true })
  expect(out.effects).toEqual([{ kind: 'restart', segs: ['branches-1', 'merge-1'] }])
  expect(l.c.state.stage).toBe('curriculum')
  expect(press(l.c, { action: 'reset:nope' })).toEqual({ events: [], effects: [] })
  expect(press(l.c, { action: 'reset:branches:fresh' }).effects).toEqual([{ kind: 'restart', segs: ['branches-1'], fresh: true }])
  expect(press(l.c, { action: 'reset::fresh' }).effects).toEqual([{ kind: 'restart', segs: ['branches-1', 'merge-1'], fresh: true }])
})

test('"I don\'t know" teaches the idea, brings the skill back, and is neither right nor wrong; the tutor sees the step', () => {
  const l = learner()
  l.toLesson()
  l.go({ action: 'next' })
  const step = git.branches1.steps[1]!
  expect(l.step()).toBe(step.id)
  const snap = snapshot(l.c)
  expect(snap).toContain(step.body)
  expect(snap).toContain(`Choices: 1) ${step.choices![0]!.code ?? step.choices![0]!.text}`)
  for (const ch of step.choices!) expect(snap).not.toContain(ch.why)
  expect(screen(l.c).actions.map(a => a.id)).toContain('dontknow')
  l.go({ action: 'dontknow' })
  const sc = screen(l.c)
  expect(sc.result?.tone).toBe('info')
  expect(sc.result?.text).toContain(step.more ?? git.branches1.steps[0]!.body)
  expect(sc.choices?.every(c => !c.mark)).toBe(true)
  expect(sc.actions.map(a => a.id)).toEqual(['next', 'prev', 'ask', 'explore'])
  expect(l.c.state).toMatchObject({ evidence: [], mistakes: [], weak: { [`skill:${step.skill}`]: { cls: 'prereq', status: 'open' } } })
  expect(stats(git.course, l.c.state, l.c.now).skills.find(k => k.id === step.skill)?.idk).toBe(1)
  expect(snapshot(l.c)).toMatch(/do not know this one/)
  l.go({ choose: step.key![0]! + 1 })
  expect(l.c.state.result[step.id]?.tone).toBe('right')
})

test('an intake question takes the learner\'s own words, and the tutor sees them', () => {
  const l = learner()
  l.take({ events: [{ ts: l.c.now, type: 'course', course: 'git' }], effects: [] })
  expect(screen(l.c).input).toBeTruthy()
  expect(l.go({ text: '   ' }).events).toEqual([])
  l.go({ text: 'I know PHP at expert level' })
  expect(l.c.state.intake[git.course.intake[0]!.id]).toBe('I know PHP at expert level')
  expect(snapshot(l.c)).toContain('"I know PHP at expert level"')
})

test('a submitted segment teaches a skill before it tests it, here or in an earlier segment', () => {
  const quiz = { ...git.branches1, id: 'quiz', steps: git.branches1.steps.filter(x => x.choices || x.check) }
  const intro = (skill: string) => ({ id: `t-${skill}`, kind: 'concept' as const, skill, difficulty: 1 as const, title: skill, body: skill })
  const [a, b] = [quiz.steps.find(x => x.skill === 'branch-model')!, quiz.steps.find(x => x.skill === 'branch-switch')!]
  expect(untaught({ ...quiz, steps: [a] }).join(' ')).toMatch(/tested before/)
  expect(untaught({ ...quiz, steps: [intro('branch-model'), a] })).toEqual([])
  expect(untaught({ ...quiz, steps: [intro('branch-model'), intro('branch-switch'), a, b] }).join(' ')).toMatch(/test skill branch-model .* before teaching branch-switch/)
  expect(untaught({ ...quiz, steps: [intro('branch-model'), a, intro('branch-switch')] }).join(' ')).toMatch(/branch-switch is taught last but never tested/)
  const earlier = [{ ...git.branches1, steps: [intro('branch-model'), a] }]
  const next = { ...quiz, skills: ['branch-switch'], steps: [intro('branch-switch'), b] }
  expect(untaught(next, earlier).join(' ')).toMatch(/uses an earlier skill/)
  expect(untaught({ ...next, steps: [intro('branch-switch'), { ...b, uses: ['branch-model'] }] }, earlier)).toEqual([])
  expect(untaught({ ...quiz, steps: quiz.steps.map(x => ({ ...x, drill: true as const })) }, earlier)).toEqual([])
  expect(validateSegment({ ...next, steps: [intro('branch-switch'), { ...b, uses: ['nope'] }] }, git.course).join(' ')).toMatch(/uses lists known skill ids/)
})

test('a segment ends with one more go at what is still open in it, then goes straight on; using old skills reviews them', () => {
  const l = learner()
  l.toLesson()
  const step = git.branches1.steps[1]!
  l.go({ action: 'next' })
  l.go({ choose: step.choices!.findIndex((_, i) => !step.key!.includes(i)) + 1 })
  expect(l.c.state.weak).not.toEqual({})
  const last = git.branches1.steps.findLastIndex(x => !x.drill)
  l.take({ events: [{ ts: l.c.now, type: 'enter', seg: 'branches-1', step: last }], effects: [] })
  l.c.state = { ...l.c.state, solved: { ...l.c.state.solved, [git.branches1.steps[last]!.id]: true } }
  l.go({ action: 'next' })
  expect(screen(l.c).progress?.label).toMatch(/^Before you move on · 1 of/)
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['skip', 'explore'])
  l.go({ action: 'skip' })
  expect(l.c.state.stage).toBe('recap')
  expect(l.c.state.gated).toEqual({ 'branches-1': true })

  const r = apply(l.c.state, { ts: l.c.now, type: 'answer', step: 'x', picked: [0], verdict: 'right', feedback: '', skill: 'branch-switch', difficulty: 1, hints: 0, uses: ['branch-model'] })
  expect(r.cards['skill:branch-model']!.reps).toBeGreaterThan(l.c.state.cards['skill:branch-model']!.reps)
})

test('a build-with-me project goes right after the current segment; the rest of that phase moves after it', () => {
  const phase = { id: 'p', title: 'Project', skills: [], segments: ['p-1', 'p-2'], project: 'practice/p' }
  const course = { ...git.course, phases: [{ id: 'a', title: 'A', skills: [], segments: ['a-1', 'a-2', 'a-3'] }, { id: 'b', title: 'B', skills: [], segments: ['b-1'] }] }
  const ids = (s: Parameters<typeof withProject>[1]) => withProject(course, s, phase).map(p => `${p.id}:${p.segments.join(',')}`)
  expect(ids(initial())).toEqual(['p:p-1,p-2', 'a:a-1,a-2,a-3', 'b:b-1'])
  expect(ids({ ...initial(), pos: { seg: 'a-2', step: 3 } })).toEqual(['a:a-1,a-2', 'p:p-1,p-2', 'a-after-p:a-3', 'b:b-1'])
  expect(ids({ ...initial(), pos: { seg: 'a-3', step: 0 }, done: 'a-3' })).toEqual(['a:a-1,a-2,a-3', 'p:p-1,p-2', 'b:b-1'])
})

test("the learner's level comes from their answers and is in the snapshot the project author reads", () => {
  const l = learner()
  l.toLesson()
  expect(level(l.c)).toMatchObject({ band: 'new', canUse: [], answers: 0 })
  expect(snapshot(l.c)).toMatch(/^Level: new \(no answers yet\)\.$/m)
  const right = (skill: string, i: number) => l.take({ events: [{ ts: l.c.now, type: 'answer', step: `s${i}`, picked: [0], verdict: 'right', feedback: '', skill, difficulty: 2, hints: 0 }], effects: [] })
  right('branch-model', 1)
  expect(level(l.c).band).toBe('beginner')
  right('branch-model', 2)
  expect(level(l.c)).toMatchObject({ band: 'developing', canUse: ['branch-model'] })
  right('branch-switch', 3); right('branch-switch', 4)
  expect(level(l.c)).toMatchObject({ band: 'confident', canUse: ['branch-model', 'branch-switch'], learning: [], notStarted: ['branch-commit', 'branch-from'] })
  expect(snapshot(l.c)).toMatch(/Level: confident \(100% right over 4 answers.*\nCan use: branch-model, branch-switch\. Still learning: none\. Not started: branch-commit, branch-from\./)
})

test('a re-plan changes only what comes after the phase being written, and keeps every project', () => {
  const c = git.course
  const project = { id: 'tool', title: 'A small tool', brief: 'b', project: 'practice/tool', skills: [c.skills[0]!.id], segments: ['tool-1'] }
  const course = { ...c, phases: [...c.phases, project] }
  const first = c.phases[0]!.segments[0]!
  const later = { id: 'later', title: 'Later', skills: [c.skills[0]!.id], segments: ['later-1'] }
  expect(replanErrors(course, [c.phases[0], later, project], first)).toEqual([])
  expect(replanErrors(course, [c.phases[0], later], first).join(' ')).toMatch(/project phase "tool" must stay/)
  expect(replanErrors(course, [later, project], first).join(' ')).toMatch(/phases\[0\] must stay exactly as it is/)
  expect(replanErrors(course, [c.phases[0], { ...later, segments: [first] }, project], first).join(' ')).toMatch(/in more than one phase/)
  expect(replanErrors(course, [c.phases[0], { ...later, skills: ['nope'] }, project], first).join(' ')).toMatch(/unknown skill nope/)
})

test('a reading for Explore: 3 to 12 sections, each with a source, short enough to read, runnable examples that say their output', () => {
  const sec = (over = {}) => ({ title: 'T', body: 'Some words.', sources: [{ title: 'Docs', url: 'https://docs.python.org/3/' }], ...over })
  const r = (sections: object[], over = {}) => ({ format: 'teachme.read/1', id: 'py-lists', topic: 'Python lists', related: ['Tuples'], sections, ...over })
  expect(validateReading(r([sec(), sec(), sec()]))).toEqual([])
  expect(validateReading(r([sec(), sec()]))).toEqual(['sections: 3 to 12'])
  expect(validateReading(r([sec(), sec(), sec()], { id: 'Py Lists' }))).toEqual(['id: lowercase letters, digits and dashes'])
  expect(validateReading(r([sec({ body: 'word '.repeat(301) }), sec(), sec()])).join(' ')).toMatch(/over 300 words; split it/)
  expect(validateReading(r([sec({ sources: [{ title: 'Docs', url: 'http://example.com' }] }), sec(), sec()])).join(' ')).toMatch(/https url/)
  expect(validateReading(r([sec({ code: { lang: 'python', source: 'print(1)' } }), sec(), sec()])).join(' ')).toMatch(/a python example needs run/)
  expect(validateReading(r([sec({ code: { lang: 'rust', source: 'fn main() {}' } }), sec(), sec()]))).toEqual([])
})

test('placement: a learner who knows some of it answers quick questions, graded on the spot; lesson 1 starts at the first miss', () => {
  const pq = (id: string, skill: string) => ({ id, kind: 'mcq' as const, skill, difficulty: 1 as const, title: id, body: `Question ${id}`, choices: [{ text: 'right', why: 'yes' }, { text: 'wrong', why: 'no' }], key: [0] })
  const course = { ...git.course, placement: [pq('pl1', 'branch-model'), pq('pl2', 'branch-switch'), pq('pl3', 'branch-commit')] }
  const start = (know: number) => {
    const l = learner()
    l.c.course = course
    l.take({ events: [{ ts: l.c.now, type: 'course', course: 'git' }], effects: [] })
    l.go({ choose: 1 }); l.go({ choose: know }); l.go({ choose: 1 })
    return l
  }
  // "Nothing yet": no check, straight to the setup and lesson 1
  const fresh = start(1)
  expect(fresh.c.state.stage).toBe('setup')
  expect(fresh.effects).toEqual([{ kind: 'setup' }])

  const l = start(3)
  expect(l.c.state.stage).toBe('placement')
  expect(l.effects).toEqual([])
  expect(screen(l.c)).toMatchObject({ kind: 'question', progress: { label: 'Where to start · 1 of 3' }, body: expect.stringMatching(/Nothing is graded[\s\S]*Question pl1/) })
  expect(screen(l.c).actions.map(a => a.id)).toEqual(['dontknow', 'skipcheck'])
  l.go({ choose: 1 })
  l.go({ action: 'dontknow' })
  l.go({ choose: 2 })
  expect(l.log.filter(e => e.type === 'placed')).toMatchObject([{ step: 'pl1', ok: true }, { step: 'pl2', ok: false }, { step: 'pl3', ok: false }])
  expect(screen(l.c)).toMatchObject({ body: 'Your lessons start at **Create and switch**.', lines: [
    { mark: 'ok', text: 'What a branch is', detail: 'You know this' }, { mark: 'now', text: 'Create and switch', detail: 'Lessons start here' }, { mark: 'todo', text: 'Commit on a branch' },
  ] })
  expect(snapshot(l.c)).toMatch(/Placement check: knew What a branch is; missed Create and switch, Commit on a branch\./)
  // Placement never counts as practice: no evidence, no review cards
  expect([l.c.state.evidence.length, Object.keys(l.c.state.cards).length]).toEqual([0, 0])
  l.go({ action: 'continue' })
  expect(l.c.state.stage).toBe('setup')
  expect(l.effects[0]).toEqual({ kind: 'setup' })

  // Skip the check: on to the setup, with no results to report
  const skip = start(2)
  skip.go({ action: 'skipcheck' })
  expect(skip.c.state.stage).toBe('setup')
  expect(snapshot(skip.c)).not.toMatch(/Placement check/)
})
