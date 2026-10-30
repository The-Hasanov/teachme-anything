import type { EngineInterface } from 'claude-code'

import type { Course, MistakeClass, Segment, Step } from '../engine/types'

export const ESCALATION_MODELS = ['sonnet', 'haiku']
export const AUTHOR_MODEL = 'sonnet'
const CLASSES: MistakeClass[] = ['slip', 'misconception', 'prereq', 'environment', 'misread']

const RULES = `You are a programming tutor's diagnosis step. A learner tried a task and the automatic check did not pass in a way the lesson script did not anticipate.
Find the most likely cause from the evidence. Classes: slip (careless error), misconception (wrong mental model), prereq (a missing earlier skill), environment (tool or setup problem, not the learner's fault), misread (did a different task than asked).
Answer with JSON only: {"class": "...", "tag": "<a tag from the catalogue or null>", "feedback": "<at most 30 words to the learner: what you see, and what to look at next>"}.
Feedback rules: plain words, address the learner as "you", name what the environment shows. Never give the full solution or the exact command that solves the task.`

export type Diagnosis = { class: MistakeClass; tag?: string; feedback: string; ms: number; model: string; usage?: unknown }

type Opts = { model?: string; effort?: 'low' | 'medium' | 'high' }

export async function diagnose($: EngineInterface, course: Course, step: Step, probe: string | undefined, got: string | undefined, all: { id: string; ok: boolean; got: string }[], opts: Opts = {}): Promise<Diagnosis> {
  const t0 = await $.clock.now()
  const skill = course.skills.find(k => k.id === step.skill)
  const tags = new Set(skill?.misconceptions.map(m => m.tag))
  const prompt = JSON.stringify({
    subject: course.subject,
    task: step.body,
    checks: step.check?.probes.map(p => ({ id: p.id, command: p.argv.join(' '), expect: p.expect })) ?? [],
    results: all,
    firstFailing: { probe, got },
    misconceptions: skill?.misconceptions ?? [],
  })
  const models = opts.model ? [opts.model] : ESCALATION_MODELS
  const stops = models.map(() => new AbortController())
  const usages: unknown[] = []
  const one = async (model: string, i: number): Promise<Omit<Diagnosis, 'ms'>> => {
    const r = await $.model.complete({ model, system: RULES, prompt, maxTokens: 200, effort: opts.effort ?? 'low', timeoutMs: 8000 }, { signal: stops[i]!.signal })
    usages.push({ model, ...(r.usage as object) })
    if (!r.isAnswered) throw new Error(r.reason)
    const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1))
    if (typeof j.feedback !== 'string' || !j.feedback.trim()) throw new Error('no feedback')
    return {
      class: CLASSES.includes(j.class) ? j.class : 'misread',
      ...(typeof j.tag === 'string' && tags.has(j.tag) ? { tag: j.tag } : {}),
      feedback: j.feedback.trim().slice(0, 400), model,
    }
  }
  try {
    const won = await Promise.any(models.map(one))
    stops.forEach(s => s.abort())
    return { ...won, ms: (await $.clock.now()) - t0, usage: usages }
  } catch {
    return {
      class: 'misread', ms: (await $.clock.now()) - t0, model: models.join('+'), usage: usages,
      feedback: `Not yet: ${probe ?? 'the check'} shows "${(got ?? '').slice(0, 80)}". Read the task again, then check once more.`,
    }
  }
}

export const AUTHOR_PROMPT = `You write lesson scripts for Teach Me, an engine that plays them to one learner without a model in the loop.
You get the course (skill map, misconception catalogue), the learner's snapshot and an example segment. Write the next segment in the same JSON format ("teachme.script/1") and submit it with the submit_segment tool. If it returns errors, fix exactly those and submit again; stop after three tries.
Rules:
- Teach, then test at once: a skill's first question or task comes right after a concept, compare, worked or stepper step with that "skill" that explains it, before the next idea is taught. A "why", feedback or "more" does not count: the learner sees those only after answering.
- Connect the ideas: a teaching step says how the new idea relates to one the learner already knows. From the second segment on, at least one question or task combines the new skill with earlier ones in a realistic situation and lists those earlier skill ids in "uses".
- 5 to 8 steps, one idea and one action each. body ≤ 80 words; extra detail in "more". Code ≤ 12 lines.
- Every choice has a "why". Questions have exactly one key (0-based). Anticipate the likely wrong answers in "wrong": class, misconception tag, short feedback, and a drill step (drill: true) as "branch" for a misconception.
- Real actions use "check" with read-only "probes" and "reference" commands that solve the task. The engine runs the reference only in a scratch copy to verify; it never shows it. Probes must fail before the task and pass after.
- A probe runs the work: its tests, the program, or the state it leaves. Never pass a task by searching its source for words. If nothing on this machine can run it, ask a question about it instead of a task.
- Hints: three levels, never the full command or solution at level 1–2; level 3 may show the shape with placeholders.
- End with one task marked "unseen": true that transfers the idea to a new, real-world situation.
- Compare with what the learner knows, and always say where the comparison stops.
- You may add new skills to the course with the newSkills field (id, title, type, prereqs, misconceptions).
- Every skill in the segment's "skills" needs a graded step (a question or a task, not a drill).
- Step kinds: concept, compare, worked, predict, mcq, spot-bug (choices are code lines), reorder (key lists every choice once, in order), trace (a table with "?" cells; key has one choice per "?" cell, row by row), stepper (2+ frames: note, optional state or code), terminal and code tasks (check; a code task names its file in "open").
- A python, sql or javascript example needs code.run {file, argv, out}: the verifier writes the source to file, runs argv and compares the output with out (in the practice folder when there is one). Every predict, mcq, spot-bug, reorder and trace step has choices and a key of 0-based indexes into them, never the answer text: a predict's keyed choice, and a trace's key cells one per line, must be exactly that output. Use "python", never "python3", in argv.
- A practice folder ("practice": {adapter, dir under practice/, scaffold}) is built with commands; ["@write", file, text] writes a file. Tests or probes must fail on the scaffold and pass after the reference.
Do not write files. Do not talk to the learner.`

export const GENERIC_INTAKE = [
  { id: 'goal', q: 'What do you want it for?', options: ['My job', 'A project of my own', 'A course or an interview', 'Curiosity'] },
  { id: 'know', q: 'What do you know already?', options: ['Nothing yet', 'The basics', 'I use it, with gaps', 'A lot: fill the gaps'] },
  { id: 'from', q: 'What do you know best?', options: ['Python', 'JavaScript or TypeScript', 'Java, C# or Go', 'No programming yet'] },
]

export const SETUP_ADAPTERS = ['git', 'python', 'node', 'cargo', 'php', 'go', 'dotnet', 'java', 'docker', 'podman', 'practice', 'verify']

const PROJECT_RULES = `Build-with-me rules (the learner and the system build one real project together, milestone by milestone):
- Each milestone is one segment whose practice.dir is the project folder. The learner's code there persists from one milestone to the next.
- practice.scaffold rebuilds the project as it stands at the start of this milestone, with the reference solutions of earlier milestones. It is used only when the folder is missing and to check the milestone in a scratch copy.
- practice.adds is the system's part, written into the learner's folder when the milestone starts: new files, boilerplate, wiring and this milestone's tests. It never writes a file the learner writes (any "open" file of the project).
- The learner writes the core: one or two "code" tasks that name their file in "open", with a check that runs this milestone's tests. Teach the idea right before each task. Tests fail after adds and pass after the reference.
- 20 to 40 minutes a milestone. Name the earlier course skills each task applies in "uses". The last milestone ends with something the learner can run and show.
- Fit the learner's level (the "Level", "Can use" and "Open weaknesses" lines of the snapshot), and re-read it for every milestone, because it changes as they go:
  - new or beginner: 3 or 4 milestones, one small task each (about 15 lines of their own code), a worked example right before each task, three hints.
  - developing: 4 or 5 milestones, one task each (up to about 30 lines), a short teaching step before each task.
  - confident: 4 to 6 milestones, up to two tasks each, some design choices left to the learner, fewer hints.
  - Tasks use the "Can use" skills. At most one skill they have not started, taught in the milestone before its task. One task practises an open weakness, if there is one.`

const codebaseRules = (root: string) => `The subject is the project in ${root}: the learner wants to learn this codebase. Read it first with Glob, Grep and Read (README, build files, entry points, main modules, tests); never change it.
- Skills are this project's architecture, main modules, data flow, conventions and how it is built and tested. Prereqs may be general skills (the language, its test tool).
- Teach with the project's real code: quote it (≤ 12 lines) and name its path. Questions ask what this code does, where a change belongs, and why it is built this way.
- Tasks run on a clone of the project: practice {adapter: "practice", dir: "practice/<course id>", scaffold: [["git","clone","--quiet","${root}","."], then the project's install commands]}. The clone has the last commit, not uncommitted changes. The learner changes it like a new contributor: fix, extend or test real code, checked by the project's own tests or a test the task adds. Every segment with tasks uses that same dir.
- Its language goes in setup (php, go, dotnet, java, node, python or cargo). On Windows, run tools that are .cmd or .bat files (npm, npx, composer, mvn, gradle) as ["cmd","/d","/c", ...].`

export function courseTask(subject: string, env: string, example: { course: Course; segment: Segment }, background?: string, project?: { title: string; pitch: string }, codebase?: string) {
  return [
    `A learner asked: "teach me ${subject}". There is no course for it yet. Write its plan: the lessons are written later, one at a time, for this learner.`,
    codebase ? codebaseRules(codebase.replace(/\\/g, '/')) : '',
    project ? `They want to build "${project.title}": ${project.pitch}. Shape the course toward it: its last phase is that project, with "project": "practice/<name>", a one-sentence "brief" and 2 to 8 milestone segment ids. Earlier phases teach what the project needs.\n${PROJECT_RULES}` : '',
    background ? `They said what they already know: "${background}". Skip that, start where it ends, and compare with it.` : '',
    `Submit the course with submit_course, then stop: format "teachme.course/1", a short id, subject, goal, intake (copy the three questions below), 4 to 10 skills (id, title, type: code | tool | data | config | ops | concept | design, prereqs, misconceptions: the 1 to 3 beliefs learners really hold, each with a tag), 2 to 5 phases (id, title, skills, segments: ids like "<phase>-1"; only the first phase needs its skills now), and setup (adapters: ${SETUP_ADAPTERS.join(', ')}; always end with "verify"; add "practice" when a segment will have a practice folder; a tool the subject needs goes first).`,
    `Add "placement": 4 or 5 questions that let a learner who knows some of this show it, so lesson 1 starts where their knowledge ends. Each is a step of kind "mcq" or "predict" (id "pl1"…, skill, difficulty, title, body, choices each with a "why", key), one per skill across the first two phases, easiest first. A predict, or python, javascript or sql code, needs code.run with its exact output, as in lessons.`,
    `A tool that is not one of those adapters (kubectl, terraform, a database server) is still a setup item: adapter is its name, "check" the command that prints its version (["kubectl","version","--client"]), "why" one line on what the course uses it for. When the learner's machine lacks it, Teach Me installs and configures it for them.`,
    `Pick how each skill is verified: code by real tests in a practice folder, tools by checking the state they leave, data by comparing results on fixture data, concepts by predict, trace and transfer questions with run examples. Use only tools the setup lists; on this machine now: ${env}.`,
    `Intake: ${JSON.stringify(GENERIC_INTAKE)}`,
    `Example course and segment (the format):\n${JSON.stringify(example.course)}\n${JSON.stringify(example.segment)}`,
  ].filter(Boolean).join('\n\n')
}

export function projectTask(course: Course, snapshot: string, pick: { title: string; pitch: string }) {
  const levelLine = snapshot.split('\n').find(l => l.startsWith('Level:'))?.replace(/^Level: /, '').replace(/\.$/, '') ?? 'unknown'
  return [
    `The learner wants to build a project together: "${pick.title}": ${pick.pitch}`,
    `Their level now: ${levelLine}. Size the project for it (see the rules below).`,
    `Plan it as a new phase of their course and submit it with submit_project: phase {id, title, brief (one sentence), project: "practice/<name>", skills (course skill ids it practises; new ones go in newSkills), segments: 2 to 8 milestone ids like "<id>-1"} and segment: milestone 1 (teachme.script/1). Fit it to what they know now: use the skills they practised, add only what the project needs.`,
    PROJECT_RULES,
    `Learner snapshot:\n${snapshot}`,
    `Course:\n${JSON.stringify(course)}`,
  ].join('\n\n')
}

export function authorTask(course: Course, example: Segment | undefined, snapshot: string, nextId: string, phaseTitle: string) {
  const phase = course.phases.find(p => p.segments.includes(nextId))
  const isLast = !!phase && !phase.project && phase.segments.length > 1 && phase.segments.at(-1) === nextId
  const isFirst = course.phases[0]?.segments[0] === nextId
  return [
    `Write segment "${nextId}" for the phase "${phaseTitle}".`,
    isFirst ? `It is the learner's first lesson. Fit it to their intake answers and placement check in the snapshot: skip what they showed they know (one line of recap at most), start at the first skill they missed, compare with the language they know best, and use examples from what they want it for.` : '',
    !phase?.project ? `Re-plan as you go: you may also submit "phases", the whole new list, to change what comes after this phase. Drop or shorten what the snapshot shows they already know, and add a phase or segment for an open weakness. Keep every phase up to and including this one exactly as it is, and keep project phases.` : '',
    phase?.project ? `It is milestone ${phase.segments.indexOf(nextId) + 1} of ${phase.segments.length} of the project "${phase.title}" (${phase.brief ?? ''}) in ${phase.project}. The example segment is the previous milestone.\n${PROJECT_RULES}` : '',
    isLast ? `It is the last segment of this phase: make it a small project, a practice task that uses the phase's skills together (${phase!.skills.join(', ')}), with "uses" naming them.` : '',
    `Learner snapshot:\n${snapshot}`,
    `Course:\n${JSON.stringify(course)}`,
    example ? `Example segment (the format, and what the learner just did):\n${JSON.stringify(example)}` : '',
  ].filter(Boolean).join('\n\n')
}

const READING_RULES = `This is a reading for Explore, not a lesson: the learner chose to study this topic freely. No questions, no tasks, no checks.
- Detailed, precise and complete: 4 to 10 sections, one idea each, in depth. Cover how it works and why, its parts and their exact behaviour, how it is used in real work, edge cases and common mistakes, and where it connects to neighbouring topics.
- Each body is Markdown, at most 300 words: short paragraphs, lists for steps or options, a table when comparing. Bold a term where it is defined.
- Precise: exact names, defaults, limits and outputs. When the behaviour changed between versions, say which version a statement holds for.
- Examples: a section's "code" is {lang, source, run?}, up to 30 lines; leave "code" out when a section has none. A python, javascript or sql example has code.run {file, argv, out}: it is run on the learner's machine, and out must be exactly what it prints. Other code is shown, not run. Use "python", never "python3".
- Sources: every section names 1 or 2 pages it rests on, official documentation, the specification or the standard, as {title, url} with an https url you are sure exists. Each url is checked; one that does not answer is rejected.
- "related": 3 to 5 topics to explore next.
Submit it with submit_reading {format: "teachme.read/1", id (lowercase, dashes), topic, skill (a course skill id, if it is one), sections: [{title, body, code?, sources}], related}. If it returns errors, fix exactly those and submit again; stop after three tries.`

export function readingTask(topic: string, env: string, snapshot?: string, deeper?: { reading: string; section: string }) {
  return [
    deeper ? `Write a reading that goes deeper into "${deeper.section}", a section of the reading "${deeper.reading}". The learner read it and wants more: go into what that section only touched, without repeating it. Its topic is "${topic}".` : `Write a reading on "${topic}".`,
    READING_RULES,
    snapshot ? `Pitch it to this learner (their course and level), without limiting it to what the course covers:\n${snapshot}` : 'There is no course here: pitch it to a developer new to this topic.',
    `On this machine: ${env}.`,
  ].join('\n\n')
}

export const DOCTOR_PROMPT = `You fix Teach Me on a learner's own machine. You get either failed setup items or a Teach Me problem
found by the doctor checks.
For each one: find the cause, fix it, then call recheck_setup. It runs the engine's own checks, so trust its ✓ or ✗
over what your shell shows, and try the next cause while an item stays ✗.
- Before each command, say in one plain sentence what it does. Installing software, or changing PATH or a shell
  profile, needs the learner's yes: the task says when they gave it with Install everything; otherwise the
  permission prompt asks them, so never work around a refusal.
- A missing tool: install it with the OS package manager (winget, brew, apt), or its official installer, then
  configure what the course needs from it (PATH, a service started, a first-run init, a local cluster or database).
  Prefer user-level installs that need no administrator rights.
- Common causes: the tool is not installed (winget on Windows, brew on macOS, the distro package manager on Linux,
  rustup for cargo); or it is installed but not on the PATH the engine inherited when Claude Code started (rustup
  puts cargo in ~/.cargo/bin through ~/.zshenv or ~/.profile). Your shell may load profiles the engine does not, so
  a tool you can run may still be missing for it: link it into a folder already on that PATH (~/.local/bin,
  /usr/local/bin), or say the learner must restart Claude Code from a new terminal.
- You are the only agent allowed to repair Teach Me files in .teachme/. Before you change one, copy it to
  .teachme/doctor-backup/<name>.<unix time>. Then:
  - course.json or a lesson in scripts/ that does not parse: fix the JSON syntax only, never its content.
  - a lesson in scripts/ that parses but the engine skips: move it to .teachme/doctor-backup/, then tell the learner
    to press Write it now in the lesson view, so it is written again.
  - ~/.teachme/vscode/<pid>.json of a process that no longer runs: delete it.
  Call snapshot afterwards to confirm the engine sees the course.
- Never change .teachme/log/ or .teachme/metrics.jsonl: they are the learner's history. Never edit practice/.
End with at most three short lines: what was wrong,
what you changed, and anything the learner still has to do.`
