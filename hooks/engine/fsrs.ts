export type Rating = 1 | 2 | 3 | 4
export type Card = { s: number; d: number; last: number; state: 'learning' | 'review' | 'relearning'; reps: number; lapses: number }

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621] as const
const w = (i: number) => W[i]!
const DECAY = -0.5
const FACTOR = 19 / 81
const DAY = 86_400_000
const S_MIN = 0.01
const S_MAX = 36500
export const RETENTION = 0.9

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
const clampD = (d: number) => clamp(d, 1, 10)
const initD = (g: Rating) => clampD(w(4) - Math.exp(w(5) * (g - 1)) + 1)
const nextD = (d: number, g: Rating) => clampD(w(7) * initD(4) + (1 - w(7)) * (d - w(6) * (g - 3) * (10 - d) / 9))
const utcDays = (a: number, b: number) => Math.floor((Date.UTC(new Date(b).getUTCFullYear(), new Date(b).getUTCMonth(), new Date(b).getUTCDate()) - Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), new Date(a).getUTCDate())) / DAY)
const curve = (days: number, s: number) => Math.pow(1 + FACTOR * days / s, DECAY)
const recall = (d: number, s: number, r: number, g: Rating) =>
  clamp(s * (1 + Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp((1 - r) * w(10)) - 1) * (g === 2 ? w(15) : 1) * (g === 4 ? w(16) : 1)), S_MIN, S_MAX)
const forget = (d: number, s: number, r: number) => clamp(w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp((1 - r) * w(14)), S_MIN, S_MAX)
const shortTerm = (s: number, g: Rating) => clamp(s * Math.exp(w(17) * (g - 3 + w(18))), S_MIN, S_MAX)

export const retrievability = (c: Card, now: number) => curve(Math.max(0, utcDays(c.last, now)), c.s)

export const intervalDays = (c: Card) => c.state === 'review' ? Math.max(1, Math.round(c.s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1))) : 1
export const dueAt = (c: Card) => c.last + intervalDays(c) * DAY

export function review(c: Card | undefined, g: Rating, now: number): Card {
  if (!c) return { s: Math.max(w(g - 1), 0.1), d: initD(g), last: now, state: g === 4 ? 'review' : 'learning', reps: 1, lapses: 0 }
  const base = { last: now, reps: c.reps + 1, d: nextD(c.d, g) }
  if (c.state !== 'review') return { ...base, s: shortTerm(c.s, g), state: g >= 3 ? 'review' : c.state, lapses: c.lapses }
  const r = curve(utcDays(c.last, now), c.s)
  if (g === 1) return { ...base, s: clamp(c.s / Math.exp(w(17) * w(18)), S_MIN, forget(c.d, c.s, r)), state: 'relearning', lapses: c.lapses + 1 }
  return { ...base, s: recall(c.d, c.s, r, g), state: 'review', lapses: c.lapses }
}

export const ratingOf = (ok: boolean, hints: number): Rating => !ok ? 1 : hints > 0 ? 2 : 3
