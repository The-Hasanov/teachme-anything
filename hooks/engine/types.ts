import type { Card } from './fsrs'

export type MistakeClass = 'slip' | 'misconception' | 'prereq' | 'environment' | 'misread'
export type SkillType = 'code' | 'tool' | 'data' | 'config' | 'ops' | 'concept' | 'design'

export type Skill = {
  id: string
  title: string
  type: SkillType
  prereqs: string[]
  misconceptions: { tag: string; belief: string; prereq?: string }[]
}

export type Requirement = { id: string; title: string; adapter: string; where: 'local' | 'container'; why?: string }

// A build-with-me project is a phase: "project" is its folder, each segment one milestone in it
export type Phase = { id: string; title: string; skills: string[]; segments: string[]; project?: string; brief?: string }

export type IntakeQuestion = { id: string; q: string; options: string[] }

export type Course = {
  format: 'teachme.course/1'
  id: string
  subject: string
  goal: string
  intake: IntakeQuestion[]
  skills: Skill[]
  phases: Phase[]
  setup: Requirement[]
}

export type Choice = { text: string; code?: string; why: string }

export type Probe = { id: string; argv: string[]; expect: { equals?: string; matches?: string; exitCode?: number } }

export type Check = { probes: Probe[]; reference: string[][] }

export type Wrong = {
  match: { choice?: number; probe?: string; got?: string }
  class: MistakeClass
  tag?: string
  feedback: string
  branch?: string
}

export type StepKind =
  | 'concept' | 'compare' | 'worked' | 'predict' | 'mcq' | 'reorder' | 'spot-bug' | 'trace'
  | 'stepper' | 'terminal' | 'code' | 'review' | 'stage'

export type Step = {
  id: string
  kind: StepKind
  skill?: string
  difficulty: 1 | 2 | 3
  title: string
  body: string
  more?: string
  code?: { lang: string; source: string; run?: { file: string; argv: string[]; out: string } }
  compare?: { with: string; text: string; stops: string }
  choices?: Choice[]
  key?: number[]
  trace?: { columns: string[]; rows: string[][] }
  frames?: { note: string; code?: string; state?: string }[]
  check?: Check
  wrong?: Wrong[]
  hints?: [string, string, string]
  open?: string
  unseen?: true
  uses?: string[]
  drill?: true
  remedy?: string
}

// scaffold builds the folder when it is missing; adds is what the system writes into it when the segment starts
export type Practice = { adapter: string; dir: string; scaffold: string[][]; adds?: string[][] }

export type Segment = {
  format: 'teachme.script/1'
  id: string
  title: string
  skills: string[]
  practice?: Practice
  steps: Step[]
}

export type Verdict = 'right' | 'partly' | 'wrong'

export type WarmItem = { seg: string; step: string; key: string }

export type Weakness = { key: string; skill?: string; tag?: string; cls: MistakeClass; count: number; status: 'open' | 'recheck' | 'resolved'; steps: string[]; used: string[]; due?: number; last: number }

export type Graded = {
  skill?: string; difficulty: number; unseen?: boolean; hints: number
  remedy?: string; review?: string; prereq?: string; uses?: string[]
  rk?: string
}

export type LogEvent = { ts: number; device?: string } & (
  | { type: 'course'; course: string }
  | { type: 'intake'; q: string; a: number | string }
  | { type: 'stage'; stage: Stage }
  | { type: 'setup'; req: string; status: SetupStatus; note?: string }
  | { type: 'enter'; seg: string; step: number; back?: number | { seg: string; step: number }; from?: string; drill?: string }
  | { type: 'warm'; items: WarmItem[]; gate?: string }
  | { type: 'warm-next' }
  | { type: 'skip'; step: string }
  | { type: 'added'; seg: string }
  | { type: 'dontknow'; step: string; skill?: string }
  | ({ type: 'answer'; step: string; picked: number[]; verdict: Verdict; class?: MistakeClass; tag?: string; feedback: string; branch?: string } & Graded)
  | ({ type: 'check'; step: string; ok: boolean; probe?: string; got?: string; class?: MistakeClass; tag?: string; feedback?: string; branch?: string; pending?: string } & Graded)
  | { type: 'feedback'; step: string; esc: string; class: MistakeClass; tag?: string; feedback: string; skill?: string }
  | { type: 'hint'; step: string; level: number }
  | { type: 'pick'; step: string; picked: number[] }
  | { type: 'frame'; step: string; i: number }
  | { type: 'aside'; on: boolean; step?: string }
  | { type: 'migrated'; skill: string; state: string; evidence: string; date: string }
  | { type: 'migrated-note'; text: string; skill?: string }
)

export type Stage = 'intake' | 'setup' | 'curriculum' | 'lesson' | 'recap'
export type SetupStatus = 'ok' | 'missing' | 'running' | 'failed'

export type Evidence = { skill: string; ts: number; ok: boolean; difficulty: number; hints: number; unseen: boolean; step: string; secs?: number }

export type LearnerState = {
  course?: string
  stage: Stage
  intake: Record<string, number | string>
  setup: Record<string, { status: SetupStatus; note?: string }>
  pos?: { seg: string; step: number; back?: { seg: string; step: number } }
  tries: Record<string, number>
  hints: Record<string, number>
  result: Record<string, { tone: 'right' | 'wrong' | 'wait'; text: string; picked?: number[]; branch?: string }>
  solved: Record<string, true>
  idk: Record<string, string>
  done?: string
  evidence: Evidence[]
  mistakes: { ts: number; step: string; skill?: string; class: MistakeClass; tag?: string }[]
  aside: boolean
  asked: Record<string, true>
  cards: Record<string, Card>
  weak: Record<string, Weakness>
  drills: Record<string, number>
  warm?: { items: WarmItem[]; i: number; n: number; gate?: string }
  gated: Record<string, true>
  added: Record<string, true>
  migrated: { skill: string; state: string; evidence: string; date: string }[]
  notes: string[]
  draft: Record<string, number[]>
  frame: Record<string, number>
  since?: number
}

export type { Action, Line, Screen } from '../../types'

export type Effect =
  | { kind: 'check'; step: string }
  | { kind: 'escalate'; esc: string; step: string; probe?: string; got?: string; picked?: number[] }
  | { kind: 'setup' }
  | { kind: 'prepare'; after: string }
  | { kind: 'remedy'; tag: string; skill?: string }
  | { kind: 'practice'; dir: string; seg: string }
  | { kind: 'ask' }

export type ProjectPick = { title: string; pitch: string; subject?: string }
export type Build = { stage: 'pick' | 'planning' | 'ready'; suggestions: ProjectPick[]; title?: string; note?: string }

export type Press = { action: string } | { choose: number } | { text: string }
