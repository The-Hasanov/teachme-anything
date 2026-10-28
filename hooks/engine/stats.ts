import { skillState } from './mastery'
import type { Course, Evidence, LearnerState, MistakeClass, Weakness } from './types'

const DAY = 86_400_000
export const WINDOW = 5
const POINTS = 40
const day = (ts: number) => Math.floor(ts / DAY)
const ratio = (a: number, b: number) => (b ? a / b : 0)

export type Stats = ReturnType<typeof stats>

const firstTries = (ev: readonly Evidence[]) => {
  const first = new Map<string, boolean>()
  for (const e of ev) if (!first.has(e.step)) first.set(e.step, e.ok)
  return ratio([...first.values()].filter(Boolean).length, first.size)
}

export function weaknessText(course: Course, w: Weakness): string {
  const belief = w.tag && course.skills.flatMap(k => k.misconceptions).find(m => m.tag === w.tag)?.belief
  return w.tag ? `The idea that ${belief ?? w.tag}` : course.skills.find(k => k.id === w.skill)?.title ?? w.key
}

export function stats(course: Course, s: LearnerState, now: number) {
  const ev = s.evidence
  const right = ev.filter(e => e.ok).length
  const secs = ev.map(e => e.secs).filter((x): x is number => x !== undefined).sort((a, b) => a - b)
  const days = new Set(ev.map(e => day(e.ts)))
  let streak = 0
  for (let d = days.has(day(now)) ? day(now) : day(now) - 1; days.has(d); d--) streak++
  const rolling = ev.map((_, i) => { const w = ev.slice(Math.max(0, i - WINDOW + 1), i + 1); return ratio(w.filter(e => e.ok).length, w.length) })
  const curve = rolling.length <= POINTS ? rolling : Array.from({ length: POINTS }, (_, i) => rolling[Math.round(i * (rolling.length - 1) / (POINTS - 1))]!)
  const mistakes: Partial<Record<MistakeClass, number>> = {}
  for (const m of s.mistakes) mistakes[m.class] = (mistakes[m.class] ?? 0) + 1

  const skills = course.skills.map(k => {
    const mine = ev.filter(e => e.skill === k.id)
    const idk = Object.values(s.idk).filter(x => x === k.id).length
    return { id: k.id, title: k.title, state: skillState(s, k.id, now), answers: mine.length, accuracy: ratio(mine.filter(e => e.ok).length, mine.length), idk }
  })
  const strengths = skills
    .filter(k => k.answers >= 2 && (k.state === 'demonstrated' || k.state === 'mastered' || k.accuracy >= 0.8))
    .sort((a, b) => b.accuracy - a.accuracy || b.answers - a.answers).slice(0, 3)
  const open = Object.values(s.weak).filter(w => w.status !== 'resolved').sort((a, b) => b.count - a.count)
  const weakSkills = skills.filter(k => k.answers >= 3 && k.accuracy < 0.6 && !open.some(w => w.skill === k.id))
  const weaknesses = [
    ...open.map(w => ({ text: weaknessText(course, w), detail: `${w.count}× wrong · ${w.status === 'recheck' ? 'fixed once, re-checked later' : 'practising now'}` })),
    ...weakSkills.map(k => ({ text: k.title, detail: `${Math.round(100 * k.accuracy)}% right of ${k.answers}` })),
  ].slice(0, 5)

  return {
    answers: ev.length, accuracy: ratio(right, ev.length), firstTry: firstTries(ev),
    hintsPerAnswer: ratio(ev.reduce((n, e) => n + e.hints, 0), ev.length),
    ...(secs.length ? { medianSecs: secs[Math.floor(secs.length / 2)]! } : {}),
    days: days.size, streak, curve, mistakes, skills, strengths, weaknesses,
  }
}

export const pct = (x: number) => `${Math.round(100 * x)}%`

export function statsText(course: Course, st: Stats): string {
  if (!st.answers) return `No answers yet in ${course.subject}.`
  const cls = Object.entries(st.mistakes).map(([k, n]) => `${n} ${k}`).join(', ')
  return [
    `${st.answers} answers · ${pct(st.accuracy)} right · ${pct(st.firstTry)} right at the first try · ${st.hintsPerAnswer.toFixed(1)} hints per answer${st.medianSecs !== undefined ? ` · ${st.medianSecs} s median` : ''}.`,
    `Active ${st.days} day${st.days === 1 ? '' : 's'}${st.streak > 1 ? `, ${st.streak} in a row` : ''}.`,
    st.curve.length >= 2 ? `Recent accuracy (last ${WINDOW}): ${pct(st.curve[0]!)} at the start, ${pct(st.curve.at(-1)!)} now.` : '',
    `Strengths: ${st.strengths.map(k => `${k.title} (${pct(k.accuracy)})`).join(', ') || 'none yet'}.`,
    `Weaknesses: ${st.weaknesses.map(w => `${w.text} (${w.detail})`).join('; ') || 'none open'}.`,
    cls ? `Mistakes by kind: ${cls}.` : '',
  ].filter(Boolean).join('\n')
}
