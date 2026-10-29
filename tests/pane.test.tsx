import { expect, mock, test } from 'claude-code/testing'

import * as bigo from '../courses/bigo'
import * as python from '../courses/python'
import { apply, press, replay, screen } from '../hooks/engine/engine'
import type { Ctx } from '../hooks/engine/engine'
import type { Course, Press, Screen, Segment } from '../hooks/engine/types'
import { isStaleScaffold, judgeProbe } from '../hooks/host/adapters'
import { lessonGuard } from '../hooks/lesson'

const ROOT = 'C:/learn'
// The kit resolves POSIX paths against the host drive (/tmp -> C:/tmp); undo that so a Linux run keys like its cwd.
// On a Linux or macOS host it resolves a drive path against the cwd (C:/learn -> /repo/C:/learn); undo that too.
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/tmp\/)/, '').replace(/^\/.*\/(?=[A-Za-z]:\/)/, '')
const PANE = {
  plugin: 'teachme-anything', component: 'Pane', requestId: 'teach',
  props: { title: 'Teach Me', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Run = (argv: readonly string[], cwd: string, path?: string) => { exitCode: number; stdout: string; stderr?: string } | undefined
const LINUX_ENV: Record<string, string> = { HOME: '/home/learner', SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' }

type Reply = { status: number; text?: string } | undefined

// Agents start from the end of a relay agent (#13): the test ends each relay, and the agent it asked for starts
function agents($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  const spawned: { prompt: string }[] = []
  const relays: string[] = []
  let n = 0
  on('agent.spawn', (_, e) => {
    const a = e as unknown as { subagent_type?: string; prompt: string }
    if (a.subagent_type === 'teachme-anything:relay') { relays.push(`r${++n}`); return { model: 'haiku', result: { agentId: `r${n}` } } }
    spawned.push(a)
    return { model: 'sonnet', result: { agentId: `a${spawned.length}` } }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const end = (agentId: string, answer = 'OK') => $.turn.complete({ agentId, answer, durationMs: 1, isAborted: false, turnId: `t-${agentId}`, reason: 'answer' })
  const relay = async () => { while (relays.length) await end(relays.shift()!) }
  return { spawned, prompts: () => spawned.map(e => e.prompt), relays, relay, end }
}

function world(on: Parameters<Parameters<typeof test>[1]>[1], run?: Run, os: 'windows' | 'linux' = 'windows') {
  const files: Record<string, string> = {}
  const calls = { model: 0, runs: [] as string[] }
  const net: { fetch?: (url: string, init?: { method?: string; headers?: Record<string, string> }) => Reply | Promise<Reply> } = {}
  const clock = mock.clock(on, { now: Date.parse('2026-10-27T10:00:00Z') })
  mock.store(on, {})
  on('env.get', (_, e) => ({ value: os === 'linux' ? LINUX_ENV[e.name] : e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? 'C:/Users/learner' : undefined }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'tutor' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__teachme-anything__${e.name}` } }))
  on('agent.register', () => ({ value: { agent: 'teachme-anything:author' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('http.fetch', async (_, e) => {
    const r = await net.fetch?.(e.url, e.init)
    if (!r) throw new Error('ECONNREFUSED')
    return { value: { ok: r.status < 300, headers: {}, text: '', requestId: '', key: '', ...r } }
  })
  on('model.complete', () => { calls.model++; return { value: { isAnswered: true, text: '{"class":"misread","feedback":"x"}' } } })
  on('fs.exists', (_, e) => ({ value: Object.keys(files).some(f => f === norm(e.path) || f.startsWith(norm(e.path) + '/')) }))
  on('fs.read', (_, e) => {
    const t = files[norm(e.path)]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.write', (_, e) => { files[norm(e.path)] = e.text; return { value: undefined } })
  on('fs.list', (_, e) => {
    const dir = norm(e.path ?? ROOT) + '/'
    const names = [...new Set(Object.keys(files).filter(f => f.startsWith(dir)).map(f => f.slice(dir.length).split('/')[0]!))]
    return { value: names.map(name => ({ name, kind: files[dir + name] !== undefined ? 'file' : 'directory', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => {
    calls.runs.push(e.argv.join(' '))
    const r = run?.(e.argv, norm(e.init?.cwd ?? ROOT), e.init?.env?.PATH)
    if (r) return { value: { stderr: '', ...r, isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: e.argv[0] === 'git' && e.argv[1] === '--version' ? 'git version 2.55.0' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { files, calls, net, clock }
}

test('teach me Git in an empty folder: course installed, pane drawn everywhere, presses never call a model', async ($, on) => {
  const { files, calls } = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const started = await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Git' } as never)
  expect(JSON.parse(started.result as string)).toMatchObject({ ok: true, course: 'Git for teamwork' })
  expect(files[`${ROOT}/.teachme/course.json`]).toContain('"teachme.course/1"')
  expect(files[`${ROOT}/.teachme/scripts/branches-1.json`]).toContain('feature/login')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Git for teamwork/ }))?.text).toBe('Git for teamwork')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(surface === 'terminal' ? 4 : 3)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'choose-1' })
  await ui.press({ key: 'choose-2' })
  await ui.press({ key: 'choose-1' })
  expect((await ui.find({ type: 'Text', text: /Your setup/ }))?.text).toBe('Your setup')
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Set up', 'Open in VS Code'])
  await ui.unmount()

  expect(calls.model).toBe(0)
  const log = Object.entries(files).find(([f]) => f.includes('/.teachme/log/'))?.[1] ?? ''
  expect(log.trim().split('\n').map(l => JSON.parse(l).type)).toEqual(['course', 'setup', 'intake', 'intake', 'intake', 'stage'])
  expect(files[`${ROOT}/PROGRESS.md`]).toMatch(/Generated by Teach Me/)
})

test('nobody edits the engine state or the practice folder by hand', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Git' } as never)
  const state = await $.tool.call({ tool: 'Write', file_path: `${ROOT}\\.teachme\\log\\d1.jsonl`, content: '{}' } as never)
  expect(state.deny).toMatch(/engine only/)
  const practice = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/practice/git-branches/app.py`, old_string: 'a', new_string: 'b' } as never)
  expect(practice.deny).toMatch(/practice work/)
  const bash = await $.tool.call({ tool: 'Bash', command: 'echo x > .teachme/course.json' } as never)
  expect(bash.deny).toMatch(/engine only/)
  const fine = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes.md`, content: 'x' } as never)
  expect(fine.result).toBe('ran')
})

test('a subject with no course: the intake runs while the author writes the course, which is validated first', async ($, on) => {
  const { files } = world(on)
  const { prompts, relay } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Kubernetes' } as never)
  expect(JSON.parse(r.result as string)).toMatchObject({ ok: true, generating: true })
  await relay()
  expect(prompts()[0]).toMatch(/teach me Kubernetes/)
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Kubernetes' } as never)
  await relay()
  expect(prompts()).toHaveLength(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['My job', 'A project of my own', 'A course or an interview', 'Curiosity', 'Open in VS Code'])
  await ui.press({ key: 'choose-1' }); await ui.press({ key: 'choose-2' }); await ui.press({ key: 'choose-1' })
  expect((await ui.find({ type: 'Text', text: /Writing your course/ }))).toBeTruthy()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Open in VS Code'])

  const submit = async (course: unknown) => JSON.parse((await $.tool.call({ tool: 'mcp__teachme-anything__submit_course', course } as never)).result as string)
  const course = {
    format: 'teachme.course/1', id: 'k8s', subject: 'Kubernetes', goal: 'run an app on a cluster', intake: [],
    skills: [{ id: 'pods', title: 'Pods', type: 'concept', prereqs: [], misconceptions: [] }],
    phases: [{ id: 'basics', title: 'Pods', skills: ['pods'], segments: ['basics-1'] }],
    setup: [{ id: 'verify', title: 'Checked on your machine', adapter: 'verify', where: 'local' }],
  }
  expect((await submit({ ...course, setup: [{ id: 'kube', title: 'A cluster', adapter: 'minikube', where: 'local' }] })).errors.join(' ')).toMatch(/adapter must be one of.*setup must end with the verify/)
  expect(await submit(course)).toMatchObject({ ok: true, next: expect.stringMatching(/basics-1/) })
  expect(files[`${ROOT}/.teachme/course.json`]).toMatch(/"What do you want it for\?"/)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Set up', 'Open in VS Code'])
  await ui.press({ key: 'act-setup' })
  await ui.press({ key: 'act-continue' })
  expect((await ui.find({ type: 'Text', text: /first lesson is being written/ }))).toBeTruthy()
  const seg = {
    format: 'teachme.script/1', id: 'basics-1', title: 'Pods', skills: ['pods'],
    steps: [{ id: 'k1', kind: 'mcq', skill: 'pods', difficulty: 1, title: 'A pod', body: 'What does a pod run?', choices: [{ text: 'Containers', why: 'Right.' }, { text: 'Clusters', why: 'A cluster runs pods.' }], key: [0] }],
  }
  const submitSeg = async (segment: unknown) => JSON.parse((await $.tool.call({ tool: 'mcp__teachme-anything__submit_segment', segment } as never)).result as string)
  expect((await submitSeg(seg)).errors.join(' ')).toMatch(/skill pods is tested before .* explains it/)
  const intro = { id: 'k0', kind: 'concept', skill: 'pods', difficulty: 1, title: 'Pods', body: 'A pod runs one or more containers together.' }
  expect(await submitSeg({ ...seg, steps: [intro, ...seg.steps] })).toMatchObject({ ok: true })
  expect(Object.entries(files).find(([f]) => f.endsWith('/.teachme/metrics.jsonl'))?.[1]).toMatch(/"kind":"segment-rejected","seg":"basics-1","errors":\["[^"]*skill pods is tested before/)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Start Pods', 'Progress', 'Open in VS Code'])
  await ui.unmount()
})

test('the terminal pane draws a trace table, a reorder answer and a stepper frame', async ($, on) => {
  world(on)
  let shown: Screen | null = null
  on('state.get', (_, e) => ({ value: { value: e.key === 'screen' && shown ? { shape: 'screen-1', value: shown } : undefined, version: 1 } }))
  const place = (course: Course, seg: Segment, id: string, presses: Press[]) => {
    const c: Ctx = { state: replay([{ ts: 0, type: 'course', course: course.id }, { ts: 0, type: 'stage', stage: 'lesson' }, { ts: 0, type: 'enter', seg: seg.id, step: seg.steps.findIndex(x => x.id === id) }]), course, segments: { [seg.id]: seg }, now: 0 }
    for (const p of presses) for (const e of press(c, p).events) c.state = apply(c.state, e)
    return screen(c)
  }
  const show = async (sc: Screen) => { shown = sc; return $.ui.mount({ ...PANE, surface: 'terminal' }) }

  let ui = await show(place(bigo.course, bigo.bigo1, 'o3', [{ choose: 1 }, { choose: 3 }]))
  expect((await ui.find({ type: 'Text', text: /^3 +▸\?/ }))).toBeTruthy()
  await ui.unmount()
  ui = await show(place(python.course, python.lists1, 'p5', [{ choose: 2 }]))
  expect((await ui.find({ type: 'Text', text: '1. def total(prices):' }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^✓ 2 / }))).toBeTruthy()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toContain('Undo')
  await ui.unmount()
  ui = await show(place(bigo.course, bigo.bigo1, 'o2', [{ action: 'frame-next' }]))
  expect((await ui.find({ type: 'Text', text: 'Frame 2 of 6' }))).toBeTruthy()
  expect((await ui.find({ type: 'Button', text: 'Next frame' }))).toBeTruthy()
  await ui.unmount()
})

test('an old-version course folder migrates on first open: originals kept, evidence carried, first lesson asked for', async ($, on) => {
  const { files } = world(on)
  const { prompts, relay } = agents($, on)
  const PROGRESS = '# Progress\r\n\r\n## Now\r\n- Review due: `branch-where`\r\n\r\n## Skills\r\n| Skill | State | Evidence | Updated |\r\n|---|---|---|---|\r\n| `branch-create` | Practiced | quiz 2/2 | 2026-10-20 |\r\n| `branch-where` | Learning | | |\r\n'
  files[`${ROOT}/COURSE.md`] = '# Course: Git for teamwork\r\n\r\n## Learner\r\n- Goal: branches at work\r\n'
  files[`${ROOT}/ROADMAP.md`] = '# Roadmap\n\n## Phase 1 — Branches\nSkills: `branch-create`, `branch-where`\n'
  files[`${ROOT}/PROGRESS.md`] = PROGRESS
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(files[`${ROOT}/.teachme/legacy/PROGRESS.md`]).toBe(PROGRESS)
  expect(files[`${ROOT}/.teachme/legacy/COURSE.md`]).toBe(files[`${ROOT}/COURSE.md`])
  expect(JSON.parse(files[`${ROOT}/.teachme/course.json`]!)).toMatchObject({ subject: 'Git for teamwork', goal: 'branches at work' })
  expect(files[`${ROOT}/PROGRESS.md`]).toMatch(/Generated by Teach Me[\s\S]*`branch-create` \| branch create \| practiced/)
  await relay()
  expect(prompts()[0]).toMatch(/Write segment "phase-1-1" for the phase "Branches"/)
  const log = Object.entries(files).find(([f]) => f.includes('/.teachme/log/'))?.[1] ?? ''
  expect(log.trim().split('\n').map(l => JSON.parse(l).type)).toEqual(['course', 'migrated', 'migrated', 'migrated-note', 'stage'])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(files[`${ROOT}/.teachme/legacy/PROGRESS.md`]).toBe(PROGRESS)
})

function machine(files: Record<string, string>): Run {
  const outs = new Map([...bigo.bigo1.steps, ...python.lists1.steps].flatMap(x => x.code?.run ? [[x.code.run.file, x.code.run.out] as const] : []))
  return (argv, cwd) => {
    if (argv[0] === 'python' && argv[1] === '--version') return { exitCode: 0, stdout: 'Python 3.13.0' }
    if (argv[0] === 'python' && outs.has(argv[1]!)) return { exitCode: 0, stdout: `${outs.get(argv[1]!)}\n` }
    if (argv[0] === 'python' && argv[1] === '-m') {
      const src = files[`${cwd}/stats.py`] ?? ''
      const test = argv.at(-1)!
      const ok = test.endsWith('test_input_unchanged') ? !src.includes('nums.sort(') : test.includes('TopThree') ? src.includes('sorted(nums, reverse=True)[:3]') && !src.includes('nums.sort(') : src.includes('seen')
      return { exitCode: ok ? 0 : 1, stdout: '', stderr: ok ? 'OK' : 'FAIL: test\nAssertionError: Lists differ' }
    }
    return undefined
  }
}

test('a whole Big-O lesson and a Python code task in the terminal pane, buttons only', async ($, on) => {
  const w: { files: Record<string, string> } = world(on, (argv, cwd) => machine(w.files)(argv, cwd))
  const press = async (ui: Awaited<ReturnType<typeof $.ui.mount>>, ...keys: string[]) => { for (const key of keys) await ui.press({ key }) }
  const title = async (ui: Awaited<ReturnType<typeof $.ui.mount>>) => (await ui.findAll({ type: 'Text' })).find(t => /^[A-Z]/.test(t.text) && !/of \d|░|▓/.test(t.text))?.text

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Big-O' } as never)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press(ui, 'choose-1', 'choose-1', 'choose-1', 'act-setup')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('✓ Examples checked on your machine')
  await press(ui, 'act-continue', 'act-start')
  expect(await title(ui)).toBe('Big-O counts growth')
  await press(ui, 'act-next', 'act-frame-next', 'act-frame-next')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Frame 3 of 6')
  await press(ui, 'act-next', 'choose-1', 'act-next')
  await press(ui, 'choose-1', 'choose-3', 'choose-6', 'choose-8')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('✓ Right, all of it.')
  await press(ui, 'act-next', 'choose-2', 'act-next')
  expect(await title(ui)).toBe('From 1024')
  await press(ui, 'choose-1', 'act-next', 'act-next')
  await press(ui, 'choose-2', 'choose-4', 'choose-6', 'choose-3', 'choose-1', 'choose-5', 'act-next', 'choose-2', 'act-next', 'choose-1', 'act-next')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Today')
  await press(ui, 'act-progress')
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(shown).toContain('Your progress')
  expect(shown).toEqual(expect.arrayContaining(['right', 'right first try', 'answers']))
  expect(shown.find(t => /^\d+%$/.test(t))).toBeDefined()
  expect(shown.find(t => /^[▁▂▃▄▅▆▇█]{2,}$/.test(t))).toBeDefined()
  expect(shown).toEqual(expect.arrayContaining(['Strengths', 'To work on', 'Skills']))
  await press(ui, 'act-back')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Today')
  const tool = await $.tool.call({ tool: 'mcp__teachme-anything__progress' } as never)
  expect(JSON.stringify(tool)).toMatch(/answers · \d+% right/)
  await ui.unmount()
  const progress = w.files[`${ROOT}/PROGRESS.md`]!
  expect(progress).toMatch(/## Your answers\n\n\d+ answers/)
  expect(progress).toMatch(/`growth-order` \| Which grows faster \| demonstrated/)
  expect(progress).toMatch(/halving n until 1/)
})

test('a Python code task in the terminal pane: where to work, a mistake caught, then solved', async ($, on) => {
  const w: { files: Record<string, string> } = world(on, (argv, cwd) => machine(w.files)(argv, cwd))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Python' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup']) await ui.press({ key })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('✓ Examples and exercises checked on your machine')
  for (const key of ['act-continue', 'act-start', 'act-next', 'choose-1', 'act-next', 'choose-2', 'act-next', 'act-next', 'choose-2', 'choose-4', 'choose-5', 'choose-3', 'choose-1', 'act-next', 'choose-1', 'act-next']) await ui.press({ key })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(await texts()).toEqual(expect.arrayContaining(['Your turn: top three', 'Edit practice/python-lists/stats.py', 'In a second terminal: cd practice/python-lists']))
  const stats = `${ROOT}/practice/python-lists/stats.py`
  w.files[stats] = 'def top_three(nums):\n    nums.sort(reverse=True)\n    return nums[:3]\n'
  await ui.press({ key: 'act-check' })
  expect((await texts()).join(' ')).toMatch(/sorts nums itself/)
  w.files[stats] = 'def top_three(nums):\n    return sorted(nums, reverse=True)[:3]\n'
  await ui.press({ key: 'act-check' })
  expect(await texts()).toContain('✓ Done. That is the result the task asked for.')
  await ui.unmount()
})

test('build with me: pick a suggested project, it is planned into the course, and milestone 1 starts with the system part written', async ($, on) => {
  const todo = `${ROOT}/practice/todo`
  const w: { files: Record<string, string> } = world(on, (argv, cwd) =>
    argv.join(' ') === 'python -m unittest' ? { exitCode: (w.files[`${cwd}/todo.py`] ?? '').includes('items.append') ? 0 : 1, stdout: '' } : machine(w.files)(argv, cwd))
  const { prompts, relay } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Big-O' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup', 'act-continue']) await ui.press({ key })

  const suggestions = [{ title: 'Todo CLI', pitch: 'a todo list that stays fast as it grows' }, { title: 'Search', pitch: 'binary search over your notes' }]
  await $.tool.call({ tool: 'mcp__teachme-anything__build_with_me', suggestions } as never)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Todo CLI: a todo list that stays fast as it grows', 'Search: binary search over your notes', 'Not now', 'Open in VS Code'])
  await ui.press({ key: 'choose-1' })
  await relay()
  expect(prompts().at(-1)).toMatch(/"Todo CLI"[\s\S]*submit_project/)
  expect(await ui.find({ type: 'Text', text: /Planning the milestones/ })).toBeTruthy()

  const submit = async (phase: unknown, segment: unknown) => JSON.parse((await $.tool.call({ tool: 'mcp__teachme-anything__submit_project', phase, segment } as never)).result as string)
  const phase = { id: 'todo', title: 'Todo CLI', brief: 'A todo list on the command line', project: 'practice/todo', skills: ['count-steps'], segments: ['todo-1', 'todo-2'] }
  const task = { id: 't2', kind: 'code', skill: 'count-steps', difficulty: 1, title: 'Write add()', body: 'Make add() keep the item.', open: 'todo.py',
    check: { probes: [{ id: 'tests', argv: ['python', '-m', 'unittest'], expect: { exitCode: 0 } }], reference: [['@write', 'todo.py', 'items = []\ndef add(x):\n    items.append(x)\n']] } }
  const m1 = {
    format: 'teachme.script/1', id: 'todo-1', title: 'Add an item', skills: ['count-steps'],
    practice: { adapter: 'python', dir: 'practice/todo', scaffold: [['@write', 'todo.py', 'items = []\ndef add(x):\n    pass\n']], adds: [['@write', 'test_todo.py', 'import todo\n']] },
    steps: [{ id: 't1', kind: 'concept', skill: 'count-steps', difficulty: 1, title: 'A list in memory', body: 'add() appends to items.' }, task],
  }
  expect((await submit(phase, m1)).errors.join(' ')).toMatch(/uses an earlier skill|tested before/)
  expect((await submit(phase, { ...m1, practice: { ...m1.practice, adds: [['@write', 'todo.py', 'x']] }, steps: [m1.steps[0], { ...task, uses: ['growth-order'] }] })).errors.join(' ')).toMatch(/adds writes todo.py, a file the learner writes/)
  expect(await submit(phase, { ...m1, steps: [m1.steps[0], { ...task, uses: ['growth-order'] }] })).toMatchObject({ ok: true, id: 'todo' })

  for (let i = 0; i < 50 && !Object.keys(w.files).some(k => k.includes('/.teachme/log/') && w.files[k]!.includes('"added"')); i++) await ui.findAll({ type: 'Text' })
  const course = JSON.parse(w.files[`${ROOT}/.teachme/course.json`]!)
  expect(course.phases.map((p: { id: string }) => p.id)).toEqual(['todo', 'basics'])
  expect(w.files[`${todo}/todo.py`]).toContain('pass')
  expect(w.files[`${todo}/test_todo.py`]).toBe('import todo\n')
  expect(await ui.find({ type: 'Text', text: 'A list in memory' })).toBeTruthy()
  expect(w.files[`${ROOT}/.teachme/log`] ?? Object.entries(w.files).find(([k]) => k.includes('/.teachme/log/'))?.[1]).toMatch(/"type":"added","seg":"todo-1"/)
  await ui.unmount()
})

// Bug reports, replayed: each test failed before its fix.

test('#14 Ask sends the step to the agent, and its explanation shows under the step; a question of their own goes too', async ($, on) => {
  const w: { files: Record<string, string> } = world(on, (argv, cwd) => machine(w.files)(argv, cwd))
  const sent: string[] = []
  on('prompt.submit', (_, e) => { sent.push(e.text ?? ''); return { text: e.text ?? '' } })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Big-O' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup', 'act-continue', 'act-start']) await ui.press({ key })
  const texts = async () => [...await ui.findAll({ type: 'Text' }), ...await ui.findAll({ type: 'Markdown' })].map(t => t.text).join(' | ')

  await ui.press({ key: 'act-ask' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/Explain the idea behind the Teach Me step "Big-O counts growth"[\s\S]*<teachme-position>[\s\S]*Big-O counts growth/)
  expect(await texts()).toMatch(/Explaining this step…/)
  // The agent's turn: its prompt is the one sent, framed by the engine
  await $.turn.start({ text: `The teachme-anything plugin sent a message:\n${sent[0]}`, turnId: 'q1' } as never)
  await $.turn.complete({ answer: 'Big-O asks how the work grows as the input grows.', durationMs: 1, isAborted: false, turnId: 'q1', reason: 'answer' })
  expect(await texts()).toMatch(/Big-O asks how the work grows as the input grows\./)

  await $.ui.input({ plugin: 'teachme-anything', key: 'intake-text', text: 'why not count seconds?' })
  expect(sent[1]).toMatch(/About the Teach Me step "Big-O counts growth": why not count seconds\?/)
  expect(await texts()).toMatch(/Answering "why not count seconds\?"…/)
  await ui.press({ key: 'act-back' })
  expect(await texts()).not.toMatch(/Answering|Explaining|Ask in the chat/)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toContain('Ask')
  await ui.unmount()
})

test('#13 the author of the next lesson, asked for by a press, starts from a relay\'s end, so its submit_segment is answered', async ($, on) => {
  // In Claude Code an agent spawned outside a hook runs under the plugin's own origin, and the engine then skips the
  // plugin's tool.call hooks for that agent's calls. The kit does not model origins, so this holds the plugin to the
  // remedy: no agent starts until a relay agent ended, and the author's calls from its own loop are answered.
  const { files } = world(on)
  const { prompts, relays, relay, end } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Kubernetes' } as never)
  expect([prompts(), relays]).toEqual([[], ['r1']])
  await relay()
  expect(prompts()[0]).toMatch(/teach me Kubernetes/)
  const call = async (tool: string, input: object, agentId: string) =>
    JSON.parse((await $.tool.call({ tool: `mcp__teachme-anything__${tool}`, ...input, agentId } as never)).result as string)
  const course = {
    format: 'teachme.course/1', id: 'k8s', subject: 'Kubernetes', goal: 'run an app on a cluster', intake: [],
    skills: [{ id: 'pods', title: 'Pods', type: 'concept', prereqs: [], misconceptions: [] }],
    phases: [{ id: 'basics', title: 'Pods', skills: ['pods'], segments: ['basics-1', 'basics-2'] }],
    setup: [{ id: 'verify', title: 'Checked on your machine', adapter: 'verify', where: 'local' }],
  }
  const lesson = (id: string, title: string, uses?: string[]) => ({
    format: 'teachme.script/1', id, title, skills: ['pods'],
    steps: [
      { id: `${id}-a`, kind: 'concept', skill: 'pods', difficulty: 1, title, body: 'A pod runs one or more containers together.' },
      { id: `${id}-b`, kind: 'mcq', skill: 'pods', difficulty: 1, title: 'A pod', body: 'What does a pod run?', choices: [{ text: 'Containers', why: 'Right.' }, { text: 'Clusters', why: 'A cluster runs pods.' }], key: [0], ...(uses ? { uses } : {}) },
    ],
  })
  expect(await call('submit_course', { course }, 'a1')).toMatchObject({ ok: true })
  expect(await call('submit_segment', { segment: lesson('basics-1', 'Pods') }, 'a1')).toMatchObject({ ok: true })
  await end('a1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-2', 'choose-1', 'act-setup', 'act-continue', 'act-start']) await ui.press({ key })
  expect([prompts().length, relays]).toEqual([1, ['r2']])
  await relay()
  expect(prompts()[1]).toMatch(/Write segment "basics-2"/)
  expect(await call('submit_segment', { segment: lesson('basics-2', 'Pods again', ['pods']) }, 'a2')).toEqual({ ok: true, id: 'basics-2' })
  await end('a2', 'Submitted basics-2.')
  expect(files[`${ROOT}/.teachme/scripts/basics-2.json`]).toContain('Pods again')
  expect(Object.entries(files).find(([f]) => f.endsWith('/.teachme/metrics.jsonl'))?.[1]).not.toMatch(/prepare-failed/)
  await ui.unmount()
})

test('#18 an author that ends without submitting records why in the metrics', async ($, on) => {
  const { files } = world(on)
  const { prompts, relays, relay, end } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Kubernetes' } as never)
  expect([prompts(), relays]).toEqual([[], ['r1']])
  await relay()
  expect(prompts()[0]).toMatch(/teach me Kubernetes/)
  const call = async (tool: string, input: object, agentId: string) =>
    JSON.parse((await $.tool.call({ tool: `mcp__teachme-anything__${tool}`, ...input, agentId } as never)).result as string)
  const course = {
    format: 'teachme.course/1', id: 'k8s', subject: 'Kubernetes', goal: 'run an app on a cluster', intake: [],
    skills: [{ id: 'pods', title: 'Pods', type: 'concept', prereqs: [], misconceptions: [] }],
    phases: [{ id: 'basics', title: 'Pods', skills: ['pods'], segments: ['basics-1', 'basics-2'] }],
    setup: [{ id: 'verify', title: 'Checked on your machine', adapter: 'verify', where: 'local' }],
  }
  const lesson = (id: string, title: string, uses?: string[]) => ({
    format: 'teachme.script/1', id, title, skills: ['pods'],
    steps: [
      { id: `${id}-a`, kind: 'concept', skill: 'pods', difficulty: 1, title, body: 'A pod runs one or more containers together.' },
      { id: `${id}-b`, kind: 'mcq', skill: 'pods', difficulty: 1, title: 'A pod', body: 'What does a pod run?', choices: [{ text: 'Containers', why: 'Right.' }, { text: 'Clusters', why: 'A cluster runs pods.' }], key: [0], ...(uses ? { uses } : {}) },
    ],
  })
  expect(await call('submit_course', { course }, 'a1')).toMatchObject({ ok: true })
  expect(await call('submit_segment', { segment: lesson('basics-1', 'Pods') }, 'a1')).toMatchObject({ ok: true })
  await end('a1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-2', 'choose-1', 'act-setup', 'act-continue', 'act-start']) await ui.press({ key })
  expect([prompts().length, relays]).toEqual([1, ['r2']])
  await relay()
  expect(prompts()[1]).toMatch(/Write segment "basics-2"/)
  await end('a2', 'cargo check failed: E0308 mismatched types\nI give up.')
  const metrics = Object.entries(files).find(([f]) => f.endsWith('/.teachme/metrics.jsonl'))?.[1] ?? ''
  expect(metrics).toMatch(/"kind":"prepare-failed","seg":"basics-2","reason":"the author stopped without submitting it, saying: cargo check failed: E0308 mismatched types"/)
  await ui.unmount()
})

test('#6 a tool installed by hand during setup is found on the next Set up press, even with no install plan (Linux)', async ($, on) => {
  let installed = false
  const w: { files: Record<string, string> } = world(on, (argv, cwd) => {
    if (/^python3?$/.test(argv[0]!) && argv[1] === '--version') return installed ? { exitCode: 0, stdout: 'Python 3.13.0' } : { exitCode: 127, stdout: '', stderr: 'not found' }
    return machine(w.files)(argv, cwd)
  }, 'linux')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Python' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup']) await ui.press({ key })
  expect(await texts()).toMatch(/python\.org/)
  installed = true
  await ui.press({ key: 'act-setup' })
  expect(await texts()).toMatch(/✓ Examples and exercises checked on your machine/)
  await ui.unmount()
})

test('only a running doctor agent may repair .teachme/, and never the learner\'s history', async ($, on) => {
  world(on)
  const live: { id: string; type: string; status: string }[] = [
    { id: 'a1', type: 'teachme-anything:doctor', status: 'running' },
    { id: 'a2', type: 'teachme-anything:author', status: 'running' },
  ]
  on('agent.list', () => ({ value: live }) as never)
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const write = async (agentId: string | undefined, file_path: string) =>
    (await $.tool.call({ tool: 'Write', file_path, content: '{}', ...(agentId ? { agentId } : {}) } as never) as { deny?: string }).deny
  const bash = async (agentId: string, command: string) => (await $.tool.call({ tool: 'Bash', command, agentId } as never) as { deny?: string }).deny
  expect(await write('a1', `${ROOT}/.teachme/scripts/types-1.json`)).toBeUndefined()
  expect(await bash('a1', 'mv .teachme/scripts/types-1.json .teachme/doctor-backup/')).toBeUndefined()
  expect(await write('a1', `${ROOT}/.teachme/log/d1.jsonl`)).toMatch(/learner's history/)
  expect(await bash('a1', 'echo x >> .teachme/metrics.jsonl')).toMatch(/learner's history/)
  expect(await write('a2', `${ROOT}/.teachme/course.json`)).toMatch(/engine only.*doctor agent repairs/)
  expect(await write(undefined, `${ROOT}/.teachme/course.json`)).toMatch(/engine only/)
  live[0]!.status = 'completed'
  expect(await write('a1', `${ROOT}/.teachme/course.json`)).toMatch(/engine only/)
})

test('#7 the Bash guard blocks writes into .teachme/ but lets reads with stderr redirects through', () => {
  const blocked = [
    'echo x > .teachme/course.json', 'echo x >> ~/.teachme/log/d1.jsonl', "echo '{}' >'.teachme/state.json'",
    'rm .teachme/course.json', 'mv a .teachme/b', "sed -i 's/a/b/' .teachme/course.json", 'echo x | tee .teachme/x',
  ]
  const allowed = [
    'ls -la ~/.teachme/vscode/ 2>&1', 'cat .teachme/course.json 2>/dev/null',
    `python3 -c "import json; print(json.load(open('.teachme/course.json'))['subject'])" 2>/dev/null`,
    'grep -c stage .teachme/log/d1.jsonl > /tmp/count.txt',
  ]
  for (const command of blocked) expect([command, lessonGuard('Bash', { command })]).toEqual([command, expect.stringMatching(/engine only/)])
  for (const command of allowed) expect([command, lessonGuard('Bash', { command })]).toEqual([command, undefined])
})

test('a failed setup item offers Fix it for me: the doctor agent fixes the machine, then the setup is checked again', async ($, on) => {
  let installed = false
  const w: { files: Record<string, string> } = world(on, (argv, cwd) => {
    if (/^python3?$/.test(argv[0]!) && argv[1] === '--version') return installed ? { exitCode: 0, stdout: 'Python 3.13.0' } : { exitCode: 127, stdout: '', stderr: 'not found' }
    return machine(w.files)(argv, cwd)
  }, 'linux')
  const { spawned, relay } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Python' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup']) await ui.press({ key })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Set up', 'Fix it for me', 'Open in VS Code'])
  await ui.press({ key: 'act-heal' })
  await relay()
  expect(spawned.map(e => JSON.stringify(e))).toEqual([expect.stringMatching(/OS: linux.*Python 3 \(adapter python\).*teachme-anything:doctor/)])
  expect(await texts()).toMatch(/Fixing your setup/)
  installed = true
  expect((await $.tool.call({ tool: 'mcp__teachme-anything__recheck_setup' } as never)).result).toMatch(/^✓ Python 3: Python 3\.13\.0\n✓ Practice folder/)
  expect(await texts()).toMatch(/✓ Python 3[\s\S]*✓ Examples and exercises checked on your machine/)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Continue', 'Open in VS Code'])
  await ui.unmount()
})

test('#12 a tool only on the login shell PATH is found, and every later command runs on that PATH', async ($, on) => {
  const pythonRuns: (string | undefined)[] = []
  const w: { files: Record<string, string> } = world(on, (argv, cwd, path) => {
    if (argv[0] === '/bin/zsh' && argv[1] === '-lc') return { exitCode: 0, stdout: '/home/learner/.pyenv/shims:/usr/bin' }
    if (/^python3?$/.test(argv[0]!)) {
      pythonRuns.push(path)
      if (!path?.includes('/home/learner/.pyenv/shims')) return { exitCode: 127, stdout: '', stderr: 'command not found' }
    }
    return machine(w.files)(argv, cwd)
  }, 'linux')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Python' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-1', 'choose-1', 'act-setup']) await ui.press({ key })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')).toMatch(/✓ Python 3[\s\S]*✓ Examples and exercises checked on your machine/)
  const after = pythonRuns.slice(pythonRuns.findIndex(p => p?.includes('.pyenv')))
  expect(after.length).toBeGreaterThan(3)
  expect(after.every(p => p === '/home/learner/.pyenv/shims:/usr/bin:/bin:/home/learner/.cargo/bin:/home/learner/.local/bin:/opt/homebrew/bin:/usr/local/bin')).toBe(true)
  await ui.unmount()
})

test('Open in VS Code in the terminal pane launches VS Code on the folder, then shows the lesson view and the step file', async ($, on) => {
  const { files, net, clock, calls } = world(on)
  const views: { layout?: unknown }[] = []
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Python' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-vscode' })
  expect(calls.runs.at(-1)).toBe(`cmd /c code ${ROOT}`)
  expect(views).toEqual([])

  files['C:/Users/learner/.teachme/vscode/7.json'] = JSON.stringify({ port: 7, token: 't', folders: [ROOT], pid: 7 })
  net.fetch = (url, init) => {
    if (url.includes('/lesson/view')) { views.push(JSON.parse((init as { body: string }).body)); return { status: 200 } }
    const reply = { status: 200, text: JSON.stringify({ boot: 'b1', last: 0, events: [] }) }
    return url.includes('wait=0') ? reply : new Promise<Reply>(() => {})
  }
  await clock.advance(2000)
  expect(views.filter(v => v.layout)).toEqual([expect.objectContaining({ screen: expect.anything(), layout: { op: 'reveal' } })])

  views.length = 0
  await ui.press({ key: 'open-vscode' })
  expect(calls.runs.filter(r => r.includes('code'))).toHaveLength(1)
  expect(views.at(-1)?.layout).toEqual({ op: 'reveal' })
  await ui.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Button', text: 'Open in VS Code' })).toBeUndefined()
  await desktop.unmount()
})

test('#25 a check whose test filter matches no test fails, and says why', () => {
  const cargo = (passed: number, filtered: number) => `running ${passed} tests\ntest result: ok. ${passed} passed; 0 failed; 0 ignored; 0 measured; ${filtered} filtered out; finished in 0.00s`
  const probe = { id: 'tests', argv: ['cargo', 'test', '-q', '--test', 'memory', 'shout'], expect: { exitCode: 0 } }
  const ran = (stdout: string) => judgeProbe(probe, { exitCode: 0, stdout, stderr: '' })
  expect(ran(`${cargo(0, 0)}\n\n${cargo(0, 4)}`)).toEqual({ id: 'tests', ok: false, got: 'the check ran no tests: the test it names is missing' })
  expect(ran(`${cargo(0, 0)}\n\n${cargo(2, 2)}`)).toMatchObject({ id: 'tests', ok: true })
  expect(ran('ok  \texample.com/m\t0.1s [no tests to run]').ok).toBe(false)
  expect(judgeProbe({ id: 'out', argv: ['python', 'x.py'], expect: { equals: '3' } }, { exitCode: 0, stdout: '3\n', stderr: '' }).ok).toBe(true)
})

test('#25 a practice folder left by an older version of the lesson is stale; the learner\'s own file does not count', async () => {
  const scaffold = [['@write', 'src/lib.rs', 'pub fn shout() {}\n'], ['@write', 'tests/memory.rs', 'shout tests\n'], ['cargo', 'fetch']]
  const folder = (files: Record<string, string>) => async (file: string) => files[file]
  const learner = new Set(['src/lib.rs'])
  expect(await isStaleScaffold(folder({ 'src/lib.rs': 'pub fn shout() { /* mine */ }\n', 'tests/memory.rs': 'shout tests\r\n' }), scaffold, learner)).toBe(false)
  expect(await isStaleScaffold(folder({ 'src/lib.rs': 'pub fn char_count() {}\n', 'tests/memory.rs': 'char_count tests\n' }), scaffold, learner)).toBe(true)
  expect(await isStaleScaffold(folder({ 'src/lib.rs': 'pub fn shout() {}\n' }), scaffold, learner)).toBe(true)
})

test('reset with new lessons: the written lessons are set aside, practice is rewritten later, and the author writes the first one again', async ($, on) => {
  const { files, net, clock, calls } = world(on)
  const { prompts, relays, relay, end } = agents($, on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Kubernetes' } as never)
  expect([prompts(), relays]).toEqual([[], ['r1']])
  await relay()
  expect(prompts()[0]).toMatch(/teach me Kubernetes/)
  const call = async (tool: string, input: object, agentId: string) =>
    JSON.parse((await $.tool.call({ tool: `mcp__teachme-anything__${tool}`, ...input, agentId } as never)).result as string)
  const course = {
    format: 'teachme.course/1', id: 'k8s', subject: 'Kubernetes', goal: 'run an app on a cluster', intake: [],
    skills: [{ id: 'pods', title: 'Pods', type: 'concept', prereqs: [], misconceptions: [] }],
    phases: [{ id: 'basics', title: 'Pods', skills: ['pods'], segments: ['basics-1', 'basics-2'] }],
    setup: [{ id: 'verify', title: 'Checked on your machine', adapter: 'verify', where: 'local' }],
  }
  const lesson = (id: string, title: string, uses?: string[]) => ({
    format: 'teachme.script/1', id, title, skills: ['pods'],
    steps: [
      { id: `${id}-a`, kind: 'concept', skill: 'pods', difficulty: 1, title, body: 'A pod runs one or more containers together.' },
      { id: `${id}-b`, kind: 'mcq', skill: 'pods', difficulty: 1, title: 'A pod', body: 'What does a pod run?', choices: [{ text: 'Containers', why: 'Right.' }, { text: 'Clusters', why: 'A cluster runs pods.' }], key: [0], ...(uses ? { uses } : {}) },
    ],
  })
  expect(await call('submit_course', { course }, 'a1')).toMatchObject({ ok: true })
  expect(await call('submit_segment', { segment: lesson('basics-1', 'Pods') }, 'a1')).toMatchObject({ ok: true })
  await end('a1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['choose-1', 'choose-2', 'choose-1', 'act-setup', 'act-continue', 'act-start']) await ui.press({ key })
  expect([prompts().length, relays]).toEqual([1, ['r2']])
  await relay()
  expect(prompts()[1]).toMatch(/Write segment "basics-2"/)
  expect(await call('submit_segment', { segment: lesson('basics-2', 'Pods again', ['pods']) }, 'a2')).toEqual({ ok: true, id: 'basics-2' })
  await end('a2', 'Submitted basics-2.')
  let release: ((r: Reply) => void) | undefined
  let seq = 0
  const reply = (events: unknown[]) => ({ status: 200, text: JSON.stringify({ boot: 'b1', last: seq, events }) })
  files['C:/Users/learner/.teachme/vscode/7.json'] = JSON.stringify({ port: 7, token: 't', folders: [ROOT], pid: 7 })
  net.fetch = url => url.includes('/lesson/view') ? { status: 200 } : url.includes('wait=0') ? reply([]) : new Promise<Reply>(r => { release = r })
  await clock.advance(2000)
  const send = async (action: string) => { seq++; release?.(reply([{ seq, type: 'press', press: { action }, t: 0 }])); await clock.advance(10) }

  await send('reset::fresh')
  expect(Object.keys(files).filter(f => f.includes('/.teachme/scripts-old/')).map(f => f.replace(/\.\d+\.json$/, '')).sort())
    .toEqual([`${ROOT}/.teachme/scripts-old/basics-1`, `${ROOT}/.teachme/scripts-old/basics-2`])
  expect(calls.runs.filter(r => r.includes(' del '))).toHaveLength(2)
  expect(relays).toEqual(['r3'])
  await relay()
  expect(prompts().at(-1)).toMatch(/Write segment "basics-1"/)
  await ui.unmount()
})

test('#10 a VS Code window driven by a newer session: this one stops drawing there and says so in its band', async ($, on) => {
  const { files, net, clock } = world(on)
  let status = 200
  let release = () => {}
  const views: string[] = []
  files['C:/Users/learner/.teachme/vscode/7.json'] = JSON.stringify({ port: 7, token: 't', folders: [ROOT], pid: 7 })
  net.fetch = (url, init) => {
    if (url.includes('/lesson/view')) { views.push(url); return { status } }
    const reply = () => ({ status, text: JSON.stringify({ boot: 'b1', last: 0, events: [] }) })
    // A long poll waits until the test lets it answer, as the window would
    return url.includes('wait=0') ? reply() : new Promise<Reply>(r => { release = () => r(reply()) })
  }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__teachme-anything__start_course', subject: 'Git' } as never)
  await clock.advance(2000)
  expect(views.length).toBeGreaterThan(0)
  status = 409
  release()
  await clock.advance(2000)
  const drawn = views.length
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'choose-1' })
  expect(views.length).toBe(drawn)
  const band = await $.ui.mount({ plugin: 'teachme-anything', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false }, surface: 'terminal' } as never)
  expect((await band.findAll({ type: 'Text' })).map(t => t.text).join(' ')).toMatch(/VS Code shows a newer Claude Code session/)
  await band.unmount()
  await ui.unmount()
})
