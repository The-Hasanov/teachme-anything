import type { Evidence, LearnerState, MistakeClass } from './types'

export type SkillState = 'not-started' | 'learning' | 'practiced' | 'demonstrated' | 'mastered'

const DAY = 86_400_000
const HALF_LIFE_DAYS = 30
const PRACTICED_AT = 2

export const weight = (e: Evidence, now: number) =>
  e.difficulty * Math.max(0, 1 - 0.25 * e.hints) * Math.pow(0.5, Math.max(0, now - e.ts) / DAY / HALF_LIFE_DAYS)

export function skillState(s: LearnerState, skill: string, now: number): SkillState {
  const ev = s.evidence.filter(e => e.skill === skill)
  const migrated = s.migrated.find(m => m.skill === skill)?.state ?? ''
  if (/^Mastered/i.test(migrated)) return 'mastered'
  if (ev.some(e => e.ok && e.unseen && e.hints === 0) || /^Demonstrated/i.test(migrated)) return 'demonstrated'
  const score = ev.reduce((sum, e) => sum + (e.ok ? weight(e, now) : -0.5 * weight(e, now)), 0)
  if (score >= PRACTICED_AT || /^Practiced/i.test(migrated)) return 'practiced'
  return ev.length || /^Learning/i.test(migrated) ? 'learning' : 'not-started'
}

export function classify(s: LearnerState, skill: string | undefined, fallback: MistakeClass): MistakeClass {
  if (!skill || fallback !== 'misconception') return fallback
  const last = s.evidence.filter(e => e.skill === skill).slice(-2)
  return last.length === 2 && last.every(e => e.ok) ? 'slip' : fallback
}
