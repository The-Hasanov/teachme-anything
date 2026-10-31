export type Line = { mark: 'ok' | 'todo' | 'fail' | 'run' | 'now'; text: string; detail?: string }
export type Action = { id: string; label: string; primary?: boolean; key?: string }
export type Screen = {
  kind: 'empty' | 'welcome' | 'intake' | 'setup' | 'curriculum' | 'step' | 'question' | 'exercise' | 'recap' | 'progress' | 'explore'
  progress?: { label: string; done: number; total: number }
  title: string
  body?: string
  more?: string
  code?: { lang: string; source: string }
  output?: string
  compare?: { with: string; text: string; stops: string }
  input?: { placeholder: string }
  choices?: { n: number; text: string; code?: string; mark?: 'right' | 'wrong' | 'key'; why?: string; used?: boolean; done?: boolean }[]
  built?: { text: string; mark?: 'right' | 'wrong' }[]
  table?: { columns: string[]; rows: { cells: string[]; at?: number; mark?: 'right' | 'wrong' }[] }
  frame?: { i: number; n: number; note: string; code?: string; state?: string }
  where?: { dir: string; file?: string }
  result?: { tone: 'right' | 'wrong' | 'wait' | 'info'; text: string }
  hint?: { level: number; text: string }
  lines?: Line[]
  tiles?: { label: string; value: string }[]
  chart?: { label: string; points: number[] }
  groups?: { title: string; lines: Line[] }[]
  actions: Action[]
}

declare module 'claude-code' {
  interface PluginState {
    'teachme-anything': {
      screen: Shaped<Screen | null>
    }
  }
}
