import { expect, test } from 'claude-code/testing'

import { dueItems, replay, snapshot } from '../hooks/engine/engine'
import { skillState } from '../hooks/engine/mastery'
import { migrate } from '../hooks/engine/migrate'
import { validateCourse } from '../hooks/engine/schema'

const T0 = Date.parse('2026-10-27T10:00:00Z')

const COURSE = `# Course: Rust for a Python developer

## Learner
- Goal: write a small CLI in Rust
- Background: Python, 5 years
`
const ROADMAP = `# Roadmap: Rust for a Python developer

## Phase 1 — Ownership
Skills: \`ownership-move\`, \`borrow-ref\`
Lessons: 01 Moves · 02 Borrows

## Phase 2 — Errors
Skills: \`result-q\`
`
const PROGRESS = `# Progress

## Now
- Mode: vscode
- Next action: lesson 02 step 2.3: a task on &mut borrows
- Review due: \`borrow-ref\`

## Skills
| Skill | State | Evidence | Updated |
|---|---|---|---|
| \`ownership-move\` | Demonstrated independently | task 01-4 passed, no hints | 2026-10-20 |
| \`borrow-ref\` | Learning | wrong on 02-2 (thought & copies) | 2026-10-21 |
| \`result-q\` | Not started | | |

## Mistakes to revisit
- \`borrow-ref\`: thought \`&v\` copies the vector
- mixed up \`String\` and \`&str\` once
`

test('an old-version folder migrates with every skill row, its evidence and its weak spots', () => {
  const { course, events } = migrate({ course: COURSE, roadmap: ROADMAP, progress: PROGRESS }, T0)
  expect(validateCourse(course)).toEqual([])
  expect(course).toMatchObject({ subject: 'Rust for a Python developer', goal: 'write a small CLI in Rust' })
  expect(course.phases.map(p => [p.title, p.skills])).toEqual([['Ownership', ['ownership-move', 'borrow-ref']], ['Errors', ['result-q']]])
  const s = replay(events)
  expect(s.migrated).toEqual([
    { skill: 'ownership-move', state: 'Demonstrated independently', evidence: 'task 01-4 passed, no hints', date: '2026-10-20' },
    { skill: 'borrow-ref', state: 'Learning', evidence: 'wrong on 02-2 (thought & copies)', date: '2026-10-21' },
    { skill: 'result-q', state: 'Not started', evidence: '', date: '' },
  ])
  expect(skillState(s, 'ownership-move', T0)).toBe('demonstrated')
  expect(skillState(s, 'borrow-ref', T0)).toBe('learning')
  expect(Object.keys(s.weak)).toEqual(['skill:borrow-ref'])
  expect(s.notes).toEqual(['Review due: borrow-ref', '`borrow-ref`: thought `&v` copies the vector', 'mixed up `String` and `&str` once', 'Next action: lesson 02 step 2.3: a task on &mut borrows'])
  expect(s.stage).toBe('curriculum')
  expect(snapshot({ state: s, course, segments: {}, now: T0 })).toMatch(/Notes from earlier sessions: .*copies the vector/)
})

test('the plain old-version template migrates too, and its weak spot waits for a lesson that can re-check it', () => {
  const { course, events } = migrate({ course: '# Course: Git for teamwork\n', progress: '## Skills\n| Skill | State | Evidence | Updated |\n|---|---|---|---|\n| `branch-create` | Learning | | |\n\n## Mistakes to revisit\n- `branch-create`: forgot to switch\n' }, T0)
  expect(validateCourse(course)).toEqual([])
  const s = replay(events)
  expect(s.migrated).toHaveLength(1)
  expect(dueItems({ state: s, course, segments: {}, now: T0 })).toEqual([])
})
