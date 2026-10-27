import type { Course, LogEvent, Skill } from './types'

export type MvpFiles = { course: string; roadmap?: string; progress: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course'
const field = (md: string, name: string) => md.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim()
const ids = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1]!)

function section(md: string, title: string): string[] {
  const lines = md.split(/\r?\n/)
  const at = lines.findIndex(l => new RegExp(`^##\\s+${title}\\s*$`, 'i').test(l))
  if (at < 0) return []
  const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  return lines.slice(at + 1, end < 0 ? undefined : end).filter(l => l.trim())
}

function skillRows(progress: string) {
  return section(progress, 'Skills')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    .filter(c => c[0] && !/^skill$/i.test(c[0]))
    .map(c => ({ id: c[0]!.replace(/`/g, ''), state: c[1] ?? '', evidence: c[2] ?? '', date: c[3] ?? '' }))
}

export function migrate(files: MvpFiles, ts: number): { course: Course; events: LogEvent[] } {
  const subject = files.course.match(/^#\s*Course:\s*(.+)$/m)?.[1]?.trim() ?? files.course.match(/^#\s*(.+)$/m)?.[1]?.trim() ?? 'Course'
  const rows = skillRows(files.progress)
  const phases = (files.roadmap ?? '').split(/\r?\n(?=##\s)/).filter(b => /^##\s/.test(b)).map((b, i) => {
    const title = b.match(/^##\s*(?:Phase\s*\d+\s*[—–-]\s*)?(.+)$/m)![1]!.trim()
    return { id: `phase-${i + 1}`, title, skills: ids(b.match(/^Skills:(.*)$/m)?.[1] ?? '') , segments: [`phase-${i + 1}-1`] }
  })
  const known = new Set([...rows.map(r => r.id), ...phases.flatMap(p => p.skills)])
  const skills: Skill[] = [...known].map(id => ({ id, title: id.replace(/-/g, ' '), type: 'concept', prereqs: [], misconceptions: [] }))
  const course: Course = {
    format: 'teachme.course/1', id: slug(subject), subject,
    goal: field(files.course, 'Goal') ?? subject,
    intake: [], skills,
    phases: phases.length ? phases : [{ id: 'phase-1', title: subject, skills: [...known], segments: ['phase-1-1'] }],
    setup: [{ id: 'verify', title: 'Check every exercise on this machine', adapter: 'verify', where: 'local' }],
  }
  const events: LogEvent[] = [
    { ts, type: 'course', course: course.id },
    ...rows.map(r => ({ ts, type: 'migrated' as const, skill: r.id, state: r.state, evidence: r.evidence, date: r.date })),
  ]
  const reviewDue = (field(files.progress, 'Review due') ?? '').replace(/^none$/i, '')
  for (const id of ids(reviewDue).filter(id => known.has(id))) events.push({ ts, type: 'migrated-note', text: `Review due: ${id}`, skill: id })
  for (const line of section(files.progress, 'Mistakes to revisit')) {
    const text = line.replace(/^\s*[-*]\s*/, '')
    const skill = ids(text).find(id => known.has(id))
    events.push({ ts, type: 'migrated-note', text, ...(skill ? { skill } : {}) })
  }
  const next = field(files.progress, 'Next action')
  if (next) events.push({ ts, type: 'migrated-note', text: `Next action: ${next}` })
  events.push({ ts, type: 'stage', stage: 'curriculum' })
  return { course, events }
}
