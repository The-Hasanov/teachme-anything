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
- 5 to 8 steps, one idea and one action each. body ≤ 80 words; extra detail in "more". Code ≤ 12 lines.
- Every choice has a "why". Questions have exactly one key (0-based). Anticipate the likely wrong answers in "wrong": class, misconception tag, short feedback, and a drill step (drill: true) as "branch" for a misconception.
- Real actions use "check" with read-only "probes" and "reference" commands that solve the task. The engine runs the reference only in a scratch copy to verify; it never shows it. Probes must fail before the task and pass after.
- Hints: three levels, never the full command or solution at level 1–2; level 3 may show the shape with placeholders.
- End with one task marked "unseen": true that transfers the idea to a new situation.
- Compare with what the learner knows, and always say where the comparison stops.
- You may add new skills to the course with the newSkills field (id, title, type, prereqs, misconceptions).
- Every skill in the segment's "skills" needs a graded step (a question or a task, not a drill).
- Step kinds: concept, compare, worked, predict, mcq, spot-bug (choices are code lines), reorder (key lists every choice once, in order), trace (a table with "?" cells; key has one choice per "?" cell, row by row), stepper (2+ frames: note, optional state or code), terminal and code tasks (check; a code task names its file in "open").
- A python, sql or javascript example needs code.run {file, argv, out}: the verifier writes the source to file, runs argv and compares the output with out (in the practice folder when there is one). A predict key, and a trace's key cells one per line, must be exactly that output. Use "python", never "python3", in argv.
- A practice folder ("practice": {adapter, dir under practice/, scaffold}) is built with commands; ["@write", file, text] writes a file. Tests or probes must fail on the scaffold and pass after the reference.
Do not write files. Do not talk to the learner.`

export const GENERIC_INTAKE = [
  { id: 'goal', q: 'What do you want it for?', options: ['My job', 'A project of my own', 'A course or an interview', 'Curiosity'] },
  { id: 'know', q: 'What do you know already?', options: ['Nothing yet', 'The basics', 'I use it, with gaps', 'A lot: fill the gaps'] },
  { id: 'from', q: 'What do you know best?', options: ['Python', 'JavaScript or TypeScript', 'Java, C# or Go', 'No programming yet'] },
]

export const SETUP_ADAPTERS = ['git', 'python', 'node', 'docker', 'podman', 'practice', 'verify']

export function courseTask(subject: string, env: string, example: { course: Course; segment: Segment }, background?: string) {
  return [
    `A learner asked: "teach me ${subject}". There is no course for it yet. Write one, then its first segment.`,
    background ? `They said what they already know: "${background}". Skip that, start where it ends, and compare with it.` : '',
    `1. Submit the course with submit_course: format "teachme.course/1", a short id, subject, goal, intake (copy the three questions below), 4 to 10 skills (id, title, type: code | tool | data | config | ops | concept | design, prereqs, misconceptions: the 1 to 3 beliefs learners really hold, each with a tag), 2 to 5 phases (id, title, skills, segments: ids like "<phase>-1"; only the first phase needs its skills now), and setup (adapters: ${SETUP_ADAPTERS.join(', ')}; always end with "verify"; add "practice" when a segment has a practice folder; a tool the subject needs goes first).`,
    `2. Submit the first segment of the first phase with submit_segment, for a beginner who knows the language in the intake.`,
    `Pick how each skill is verified: code by real tests in a practice folder, tools by checking the state they leave, data by comparing results on fixture data, concepts by predict, trace and transfer questions with run examples. Use only tools the setup installs; on this machine: ${env}.`,
    `Intake: ${JSON.stringify(GENERIC_INTAKE)}`,
    `Example course and segment (the format):\n${JSON.stringify(example.course)}\n${JSON.stringify(example.segment)}`,
  ].filter(Boolean).join('\n\n')
}

export function authorTask(course: Course, example: Segment | undefined, snapshot: string, nextId: string, phaseTitle: string) {
  return [
    `Write segment "${nextId}" for the phase "${phaseTitle}".`,
    `Learner snapshot:\n${snapshot}`,
    `Course:\n${JSON.stringify(course)}`,
    example ? `Example segment (the format, and what the learner just did):\n${JSON.stringify(example)}` : '',
  ].filter(Boolean).join('\n\n')
}
