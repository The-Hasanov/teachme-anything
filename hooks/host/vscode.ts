import type { EngineInterface } from 'claude-code'

import type { Dashboard, Press, Screen } from '../engine/types'

export type LayoutOp = { op: 'terminal'; cwd: string } | { op: 'reference'; path: string } | { op: 'practice'; path: string } | { op: 'reveal'; cwd?: string; path?: string }
type Endpoint = { url: string; token: string; pid: number }
type Incoming = { seq: number; type: 'press'; press: Press; t: number } | { seq: number; type: 'ready' }

const WAIT_MS = 20_000
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()

export type VsCode = {
  root: string
  onPress: (p: Press, sentAt?: number) => void
  onReady: () => void
  ep?: Endpoint
  after: number
  boot?: string
  isPolling: boolean
  isUp: boolean
  // The window serves one session, the newest: an older one in the same folder is turned away (409)
  session: string
  started: number
  isElsewhere?: boolean
}

export const newVsCode = (root: string, onPress: VsCode['onPress'], onReady: VsCode['onReady']): VsCode =>
  ({ root, onPress, onReady, after: 0, isPolling: false, isUp: false, session: Math.random().toString(36).slice(2, 10), started: Date.now() })

const headers = (v: VsCode, ep: Endpoint) => ({ 'x-teachme-token': ep.token, 'x-teachme-session': v.session, 'x-teachme-started': String(v.started) })

async function find($: EngineInterface, root: string): Promise<Endpoint | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  const dir = `${home.split('\\').join('/')}/.teachme/vscode`
  const files = [...await $.fs.list(dir).catch(() => [])].sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue
    try {
      const w = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as { port: number; token: string; folders: string[]; pid: number }
      if (w.folders.some(x => norm(x) === norm(root))) return { url: `http://127.0.0.1:${w.port}`, token: w.token, pid: w.pid }
    } catch { }
  }
  return undefined
}

export async function tick($: EngineInterface, v: VsCode) {
  if (v.isPolling) return
  v.isPolling = true
  try {
    v.ep ??= await find($, v.root)
    while (v.ep) {
      const ep = v.ep
      const wait = v.boot ? WAIT_MS : 0
      const res = await $.http.fetch(`${ep.url}/lesson/events?after=${v.after}&wait=${wait}`, { headers: headers(v, ep) }).catch(() => undefined)
      v.isElsewhere = res?.status === 409
      if (v.isElsewhere) { v.isUp = false; v.boot = undefined; break }
      if (!res?.ok) { v.ep = undefined; v.isUp = false; v.boot = undefined; break }
      const body = JSON.parse(res.text) as { boot: string; last: number; events: Incoming[] }
      const isNew = body.boot !== v.boot
      v.boot = body.boot
      v.isUp = true
      const fresh = isNew ? [] : body.events
      v.after = body.last
      if (isNew) v.onReady()
      for (const e of fresh) {
        if (e.type === 'press') v.onPress(e.press, e.t)
        if (e.type === 'ready') v.onReady()
      }
    }
  } finally {
    v.isPolling = false
  }
}

export async function sendView($: EngineInterface, v: VsCode, screen: Screen, layout?: LayoutOp, dashboard?: Dashboard) {
  const ep = v.ep
  if (!ep || v.isElsewhere) return
  await $.http.fetch(`${ep.url}/lesson/view`, {
    method: 'POST', headers: { ...headers(v, ep), 'content-type': 'application/json' },
    body: JSON.stringify({ screen, ...(layout ? { layout } : {}), ...(dashboard ? { dashboard } : {}) }),
  }).catch(() => undefined)
}
