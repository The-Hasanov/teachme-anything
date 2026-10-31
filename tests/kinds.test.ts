import { expect, test } from 'claude-code/testing'

import * as bigo from './fixtures/bigo'
import * as git from './fixtures/git'
import * as python from '../hooks/host/example'
import * as sql from './fixtures/sql'
import { apply, press, replay, screen } from '../hooks/engine/engine'
import type { Ctx } from '../hooks/engine/engine'
import { validateCourse, validateSegment } from '../hooks/engine/schema'
import type { Course, LogEvent, Press, Segment } from '../hooks/engine/types'

const T0 = Date.parse('2026-10-27T10:00:00Z')
const LIBRARY = [git, python, sql, bigo]

function at(course: Course, seg: Segment, stepId: string) {
  const step = seg.steps.findIndex(x => x.id === stepId)
  const log: LogEvent[] = [{ ts: T0, type: 'course', course: course.id }, { ts: T0, type: 'stage', stage: 'lesson' }, { ts: T0, type: 'enter', seg: seg.id, step }]
  const c: Ctx = { state: replay(log), course, segments: { [seg.id]: seg }, now: T0 }
  const go = (p: Press) => {
    const out = press(c, p)
    for (const e of out.events) { c.state = apply(c.state, e); log.push(e) }
    c.now += 1000
    return out
  }
  return { c, go, log, sc: () => screen(c) }
}

test('every course in the library is valid, with every runnable example set to run', () => {
  for (const lib of LIBRARY) {
    expect(validateCourse(lib.course)).toEqual([])
    for (const seg of lib.segments) expect(validateSegment(seg, lib.course)).toEqual([])
  }
  expect(LIBRARY.map(l => [...new Set(l.course.skills.map(k => k.type))].join('+'))).toEqual(['concept+tool', 'code', 'data', 'concept'])
  const bad = { ...bigo.bigo1, steps: [{ ...bigo.bigo1.steps[3]!, code: { lang: 'python', source: 'print(1)' } }] }
  expect(validateSegment(bad, bigo.course).join('\n')).toMatch(/needs code.run/)
})

test('reorder: one press per line, undo, then graded as a whole; a misplaced line says which', () => {
  const l = at(python.course, python.lists1, 'p5')
  l.go({ choose: 2 }); l.go({ choose: 4 })
  expect(l.sc().built?.map(b => b.text)).toEqual(['def total(prices):', '    result = 0'])
  expect(l.sc().choices?.filter(ch => ch.used).map(ch => ch.n)).toEqual([2, 4])
  expect(l.go({ choose: 2 }).events).toEqual([])
  l.go({ action: 'undo' })
  expect(l.sc().built).toHaveLength(1)
  l.go({ choose: 3 }); l.go({ choose: 4 }); l.go({ choose: 5 }); l.go({ choose: 1 })
  const sc = l.sc()
  expect(sc.result).toMatchObject({ tone: 'wrong' })
  expect(sc.result?.text).toMatch(/^Number 2 is not right yet: This adds each price/)
  expect(sc.built?.map(b => b.mark)).toEqual(['right', 'wrong', 'wrong', 'wrong', 'right'])
  expect(replay(l.log)).toEqual(l.c.state)
})

test('reorder right in one go', () => {
  const l = at(sql.course, sql.sql1, 'q4')
  for (const n of [4, 2, 3, 1]) l.go({ choose: n })
  expect(l.sc().result).toEqual({ tone: 'right', text: 'Right, all of it.' })
  expect(l.c.state.solved.q4).toBe(true)
})

test('trace: one cell per press, the table fills in, and a doubled count is the misconception it is', () => {
  const l = at(bigo.course, bigo.bigo1, 'o3')
  expect(l.sc().table?.rows[0]).toEqual({ cells: ['1', '?'], at: 1 })
  expect(l.sc().output).toBeUndefined()
  l.go({ choose: 1 }); l.go({ choose: 3 })
  expect(l.sc().table?.rows.map(r => r.cells[1])).toEqual(['1', '4', '?', '?'])
  expect(l.sc().table?.rows[2]?.at).toBe(1)
  const out = l.go({ choose: 4 })
  expect(out.events).toHaveLength(1)
  l.go({ choose: 8 })
  const sc = l.sc()
  expect(sc.result?.text).toMatch(/n × n, not n \+ n/)
  expect(sc.table?.rows.map(r => r.mark)).toEqual(['right', 'right', 'wrong', 'right'])
  expect(sc.output).toBe('1\n4\n9\n16')
  expect(l.c.state.weak['nested-is-double']).toMatchObject({ status: 'open' })
  expect(sc.actions[0]).toMatchObject({ id: 'next', label: 'Practice this' })
  l.go({ action: 'next' })
  expect(l.sc().title).toBe('Ten by ten')
})

test('a trace accepts any choice with the right text', () => {
  const l = at(sql.course, sql.sql1, 'q3d')
  for (const n of [2, 1, 3, 3]) l.go({ choose: n })
  expect(l.sc().result?.tone).toBe('right')
})

test('stepper: frame by frame, back a frame, and the learner may skip ahead', () => {
  const l = at(bigo.course, bigo.bigo1, 'o2')
  expect(l.sc().frame).toMatchObject({ i: 0, n: 6, note: 'Start at the first item. Is 4 the target?' })
  expect(l.sc().actions.map(a => a.id)).toEqual(['frame-next', 'next', 'prev', 'ask', 'explore'])
  l.go({ action: 'frame-next' }); l.go({ action: 'frame-next' }); l.go({ action: 'frame-prev' })
  expect(l.sc().frame?.i).toBe(1)
  for (let i = 0; i < 6; i++) l.go({ action: 'frame-next' })
  expect(l.sc().frame?.i).toBe(5)
  expect(l.sc().actions.map(a => a.id)).toEqual(['next', 'frame-prev', 'prev', 'ask', 'explore'])
  expect(l.sc().output).toBe('5')
  l.go({ action: 'next' })
  expect(l.sc().title).toBe('The worst case')
})

test('spot-the-bug picks a line; a code task is an exercise checked by its tests', () => {
  const l = at(python.course, python.lists1, 'p6')
  expect(l.sc().choices?.map(ch => ch.code)).toEqual(['def add(item, basket=[]):', '    basket.append(item)', '    return basket'])
  l.go({ choose: 2 })
  expect(l.c.state.weak['mutable-default']).toBeDefined()
  const t = at(python.course, python.lists1, 'p7')
  expect(t.sc().kind).toBe('exercise')
  expect(t.go({ action: 'check' }).effects).toEqual([{ kind: 'check', step: 'p7' }])
})

test('#15 a predict step with a run output but no choices is refused, and one cached before that can be left with Next', () => {
  const o4 = bigo.bigo1.steps.find(x => x.id === 'o4')!
  // What the author wrote in the report: the answer text as the key, no choices
  const { choices: _c, wrong: _w, ...rest } = o4
  const bare = { ...rest, key: '6' } as unknown as typeof o4
  const seg = { ...bigo.bigo1, steps: bigo.bigo1.steps.map(x => (x.id === 'o4' ? bare : x)) }
  expect(validateSegment(seg, bigo.course).join('\n')).toMatch(/o4\): a predict step needs choices and a key/)
  for (const kind of ['mcq', 'reorder', 'spot-bug', 'trace'] as const) {
    const g = { ...seg, steps: seg.steps.map(x => (x.id === 'o4' ? { ...bare, kind } : x)) }
    expect(validateSegment(g, bigo.course).join('\n')).toMatch(new RegExp(`a ${kind} step needs choices`))
  }

  const l = at(bigo.course, seg, 'o4')
  expect(l.sc().output).toBe('6')
  expect(l.sc().actions.map(a => a.id)).toEqual(['next', 'prev', 'ask', 'explore'])
  expect(l.go({ action: 'next' }).events.map(e => e.type)).toEqual(['enter'])
})
