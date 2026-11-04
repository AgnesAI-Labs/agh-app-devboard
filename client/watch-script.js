// The 「宁川的一天」 player on the watch page. The script itself lives on the server (watch-script.mjs, adapted to the
// group's members); this hook only paces it: every event is posted through the page's ordinary post path, the same one
// a typed message or a signal takes, so the rule layer and the coordinator treat it like any other. It runs while the
// page is open; leaving the page pauses it, and the position is kept per group so coming back continues, not repeats.
import { Button } from '@agnes/web-ui'
import React from 'react'
import { h } from './board.js'

export const SPEEDS = [1, 4, 16]
const TICK_MS = 250
const keyOf = (projectId) => `devboard.watch.script.${projectId}`
const saved = (projectId) => {
  try {
    const v = JSON.parse(window.localStorage.getItem(keyOf(projectId)) ?? 'null')
    return v && Number.isInteger(v.cursor) ? v : { cursor: 0, clock: 0, threads: {} }
  } catch {
    return { cursor: 0, clock: 0, threads: {} }
  }
}
const persist = (projectId, s) => {
  try {
    if (s.cursor > 0) window.localStorage.setItem(keyOf(projectId), JSON.stringify({ cursor: s.cursor, clock: s.clock, threads: s.threads }))
    else window.localStorage.removeItem(keyOf(projectId))
  } catch {}
}

/**
 * phase: idle (nothing running; `cursor` > 0 means a stopped run to continue) → planning → confirm → playing ⇄ paused → done.
 * `post(input)` posts one event and returns the service output, or a falsy value when it was refused (the player pauses).
 */
export function useScriptPlayer({ services, projectId, post }) {
  const s = React.useRef({ ...saved(projectId), events: [] })
  const [ui, setUi] = React.useState({ phase: 'idle', plan: null, cursor: s.current.cursor, total: 0, speed: 1, error: '' })
  const phase = React.useRef('idle')
  const speed = React.useRef(1)
  const postRef = React.useRef(post)
  postRef.current = post
  const busy = React.useRef(false)
  const set = (patch) => {
    if ('phase' in patch) phase.current = patch.phase
    setUi((u) => ({ ...u, ...patch }))
  }
  // another group has its own position; the one we leave stops
  React.useEffect(() => {
    s.current = { ...saved(projectId), events: [] }
    phase.current = 'idle'
    setUi((u) => ({ ...u, phase: 'idle', plan: null, cursor: s.current.cursor, total: 0, error: '' }))
  }, [projectId])

  const begin = async () => {
    set({ phase: 'planning', error: '' })
    try {
      const out = await services.query('devboard.watch.script', { projectId, from: s.current.cursor })
      if (out?.ok === false) throw new Error(out.error)
      s.current.events = out.events
      set({ phase: 'confirm', plan: out.plan, total: out.events.length })
    } catch (e) {
      set({ phase: 'idle', error: `读取剧本失败：${e instanceof Error ? e.message : e}` })
    }
  }
  const play = () => set({ phase: 'playing' })
  const pause = () => set({ phase: 'paused' })
  const cancel = () => set({ phase: 'idle', plan: null })
  const clear = () => {
    s.current = { cursor: 0, clock: 0, threads: {}, events: [] }
    persist(projectId, s.current)
    set({ phase: 'idle', plan: null, cursor: 0, total: 0 })
  }
  const setSpeed = (v) => {
    speed.current = v
    setUi((u) => ({ ...u, speed: v }))
  }

  React.useEffect(() => {
    if (ui.phase !== 'playing') return undefined
    const tick = async () => {
      if (busy.current) return
      busy.current = true
      const run = s.current
      try {
        run.clock += (TICK_MS / 1000) * speed.current // script minutes: 1x is one minute of the day per second
        while (phase.current === 'playing' && run.cursor < run.events.length && run.events[run.cursor].t <= run.clock) {
          const e = run.events[run.cursor]
          const out = await postRef.current({
            by: e.by,
            source: e.source,
            text: e.text,
            ...(e.from ? { from: e.from } : {}),
            ...(e.thread && run.threads[e.thread] ? { threadId: run.threads[e.thread] } : {}),
          })
          if (s.current !== run) return // reset or another group while the post was out
          if (!out) {
            set({ phase: 'paused', error: '剧本在这一条暂停了（原因见上方提示），可以继续或重置。' })
            return
          }
          if (e.thread && !run.threads[e.thread]) run.threads[e.thread] = out.message.threadId
          run.cursor += 1
          persist(projectId, run)
          set({ cursor: run.cursor })
        }
        if (run.cursor >= run.events.length && phase.current === 'playing') {
          persist(projectId, { ...run, cursor: 0 }) // a finished day is not resumed
          set({ phase: 'done' })
        }
      } finally {
        busy.current = false
      }
    }
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [ui.phase, projectId])

  return { ...ui, begin, play, pause, cancel, clear, setSpeed }
}

/** The desk's script block: start (with the model-call count and a confirm), pause, speed, reset. */
export function ScriptPanel({ player: p, me, manager, busy, reset }) {
  const [asking, setAsking] = React.useState(false)
  const running = p.phase === 'playing' || p.phase === 'paused'
  const plan = p.plan
  return h(
    'div',
    { className: 'dw-script', 'data-testid': 'watch-script', 'data-phase': p.phase },
    h('div', { className: 'dw-script-head' }, h('b', null, '「宁川的一天」'), h('span', { className: 'dw-muted' }, '预设事件按时间注入，和真实消息、信号走同一条处理链')),
    p.error && h('p', { className: 'dw-would', role: 'status' }, p.error),
    (p.phase === 'idle' || p.phase === 'planning') &&
      h(
        'div',
        { className: 'dw-actions' },
        h(
          Button,
          { appearance: 'primary', disabled: !me || p.phase === 'planning', disabledReason: me ? undefined : '先在顶部选择「我是谁」', onClick: p.begin },
          p.phase === 'planning' ? '正在计算…' : p.cursor > 0 ? `继续「宁川的一天」（已播 ${p.cursor} 条）` : '播放「宁川的一天」',
        ),
      ),
    p.phase === 'confirm' &&
      plan &&
      h(
        'div',
        { className: 'dw-script-confirm', 'data-testid': 'watch-script-confirm', role: 'group', 'aria-label': '播放前确认' },
        h('p', null, `将注入 ${plan.total} 条事件：规则层挡掉 ${plan.filtered} 条，仅记录 ${plan.recorded + plan.shadow} 条，`, h('b', { 'data-testid': 'watch-script-handoff' }, plan.handoff), ' 条会交给协调员判断。'),
        h('p', { className: 'dw-muted' }, `每一条都是一次真实的模型调用${plan.followUps ? `；已立项线程里的 ${plan.followUps} 条跟进也会送达协调员` : ''}。`),
        h('div', { className: 'dw-actions' }, h(Button, { onClick: p.cancel }, '取消'), h(Button, { appearance: 'primary', onClick: p.play }, `确认，开始播放（${plan.handoff} 次模型调用）`)),
      ),
    (running || p.phase === 'done') &&
      h(
        'div',
        { className: 'dw-script-run' },
        h('p', { 'data-testid': 'watch-script-progress' }, p.phase === 'done' ? '剧本播完了' : p.phase === 'playing' ? '播放中' : '已暂停', ` · 已注入 ${p.cursor} / ${p.total} 条`),
        running &&
          h(
            'div',
            { className: 'dw-actions' },
            h(Button, { onClick: p.phase === 'playing' ? p.pause : p.play }, p.phase === 'playing' ? '暂停' : '继续'),
            h('span', { role: 'group', 'aria-label': '倍速', className: 'dw-speed' }, SPEEDS.map((v) => h(Button, { key: v, 'aria-pressed': p.speed === v, appearance: p.speed === v ? 'primary' : undefined, onClick: () => p.setSpeed(v) }, `${v}x`))),
          ),
      ),
    h(
      'div',
      { className: 'dw-actions' },
      asking
        ? [
            h('span', { key: 't', className: 'dw-muted' }, '清空本群的消息、判定和工单？成员与规则保留。'),
            h(Button, { key: 'n', onClick: () => setAsking(false) }, '取消'),
            h(Button, { key: 'y', appearance: 'primary', disabled: busy, onClick: async () => ((await reset()) && setAsking(false)) }, '确认重置'),
          ]
        : h(Button, { disabled: !manager || busy, disabledReason: manager ? undefined : '只有项目经理和技术负责人可以重置', onClick: () => setAsking(true) }, '重置值守记录'),
    ),
  )
}
