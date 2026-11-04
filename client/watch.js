// Watch center page: the project group's chat on the left, "what needs me / what the system is doing" on the
// right, and a provenance drawer. Everything shown is a stored record from devboard.watch.snapshot; nothing
// here decides anything. Text from people, signals and models goes through reveal() before it is drawn.
import { Badge, Button, Drawer, Select } from '@agnes/web-ui'
import React from 'react'
import { ALLOW, capabilityDenied, DENY, permissionSummary, reveal, textOf, turnError } from './assistant-model.js'
import { coordinatorFor } from './assistant-session.js'
import { gateName, h, jumpTo } from './board.js'
import { coordinatorBrief, humanActBrief } from './watch-brief.js'
import { ScriptPanel, useScriptPlayer } from './watch-script.js'

const POLL_MS = 5000
const safe = (x) => reveal(String(x ?? ''))
const SRC = { im: 'IM', ci: 'CI', phm: 'PHM', email: '邮件' }
const SRC_ICON = {
  im: 'M4 5h16v11H9l-5 4z',
  ci: 'M6 8v8M18 11c0 4-6 3-12 5M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  phm: 'M3 12h4l2-6 4 12 2-6h6',
  email: 'M3 7l9 6 9-6M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
}
const STATE = {
  queued: ['排队中', 'off'],
  running: ['运行中', 'ok'],
  waiting_human: ['等人决定', 'warn'],
  speculative_ready: ['草稿待采纳', 'warn'],
  done: ['已交付', 'ok'],
  stalled: ['已停滞', 'bad'],
  discarded: ['已丢弃', 'off'],
}
const FUNNEL = [
  ['received', '进入'],
  ['ruleFiltered', '规则挡掉'],
  ['routed', '线程直送'],
  ['sentToModel', '交给协调员判断'],
  ['accepted', '立项'],
  ['interruptions', '打扰你'],
  ['delivered', '交付'],
]
const SIGNALS = [
  ['ci', 'CI 失败', 'door-ctrl-fw #482 构建失败：test_obstacle_retry 超时'],
  ['ci', 'CI 通过', 'door-ctrl-fw #483 构建通过 ✅'],
  ['phm', 'PHM 告警', '告警：5号线 3 号门 关门到位信号抖动 (1/3)'],
  ['phm', 'PHM 心跳', 'PHM 心跳：5号线 全部 32 个车门节点在线'],
  ['email', '客户询问进展', '来函：请告知 DEF-0137 当前处理进展与预计关闭时间。'],
  ['email', '客户条款来函', '来函：关于夹紧力条款第 6.3 条，请贵司书面说明满足依据。'],
]
const ACT_PAGE = { gate: 'gate', flow: 'approval', intervention: 'intervention' }
const clock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—'
const ago = (now, iso) => {
  const n = Math.round((Date.parse(now) - Date.parse(iso)) / 60_000)
  return n < 1 ? '刚刚' : `${n} 分钟前`
}
const store = (key, value) => {
  try {
    if (value === undefined) return window.localStorage.getItem(key)
    window.localStorage.setItem(key, value)
  } catch {}
  return null
}

function useWatch(ctx, projectId, memberId) {
  const services = ctx.profile.services
  const [snap, setSnap] = React.useState(null)
  const [error, setError] = React.useState('')
  const [loadError, setLoadError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const alive = React.useRef(true)
  const latest = React.useRef(0)
  const load = React.useCallback(async () => {
    if (!projectId) return
    const mine = ++latest.current
    try {
      const next = await services.query('devboard.watch.snapshot', { projectId, ...(memberId ? { memberId } : {}) })
      if (!alive.current || mine !== latest.current) return
      setSnap(next)
      setLoadError('')
    } catch (e) {
      if (alive.current && mine === latest.current)
        setLoadError(`读取值守记录失败：${e instanceof Error ? e.message : e}`)
    }
  }, [services, projectId, memberId])
  React.useEffect(() => {
    alive.current = true
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [load])
  // a confirmation fades by itself; errors stay until the next action
  React.useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])
  const run = React.useCallback(
    async (service, input, done) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const receipt = await services.effect(service, { projectId, ...input }, { operationId: crypto.randomUUID() })
        const state = receipt.state ?? 'completed'
        if (state === 'completed' && receipt.output?.ok === false) setError(receipt.output.error)
        else if (state === 'completed') setNotice(done)
        else setError(`操作未执行（${state}${receipt.code ? `：${receipt.code}` : ''}）`)
        return state === 'completed' && receipt.output?.ok !== false ? (receipt.output ?? {}) : null
      } catch (e) {
        setError(`操作失败：${e instanceof Error ? e.message : e}`)
        return null
      } finally {
        await load()
        if (alive.current) setBusy(false)
      }
    },
    [services, projectId, load],
  )
  return { snap: snap?.projectId === projectId ? snap : null, error: error || loadError, notice, busy, run, load }
}

const MANAGERS = ['项目经理', '技术负责人']
const reason = (e) => (e instanceof Error ? e.message : String(e))

/**
 * The group's coordinator session: re-attached on every visit once the group has one (created at the first message
 * that needs it), its busy state and CAPABILITY_DENIED read from the ledger, its tool permission requests in `perms`.
 */
function useCoordinator(ctx, projectId, stored, refresh) {
  const { assistant, queue } = React.useMemo(() => coordinatorFor(ctx, projectId), [ctx, projectId])
  const perms = React.useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot)
  const [st, setSt] = React.useState({ busy: false, denied: false, error: '', failed: '' })
  const storedRef = React.useRef(stored)
  storedRef.current = stored
  const refreshRef = React.useRef(refresh)
  refreshRef.current = refresh
  const sessionId = stored?.sessionId
  React.useEffect(() => {
    setSt({ busy: false, denied: false, error: '', failed: '' })
    if (!sessionId) return undefined
    let off
    let dead = false
    const names = new Map()
    const onEvent = (e) => {
      if (e.type === 'turn/start') setSt((x) => ({ ...x, busy: true, failed: '' }))
      else if (e.type === 'turn/end') {
        const failed = turnError(e.data)
        setSt((x) => ({ ...x, busy: false, failed: failed ? `协调员这一轮没有完成（${failed.code}: ${failed.message}）。可以再发一条消息重试。` : e.data?.reason === 'blocked' ? '协调员这一轮被自动检查拦下了；下一条消息会让它继续。' : '' }))
        refreshRef.current()
      } else if (e.type === 'tool/call') names.set(e.data?.toolUseId, String(e.data?.name ?? ''))
      else if (e.type === 'tool/result') {
        if (e.data?.isError === true && capabilityDenied(textOf(e.data))) setSt((x) => ({ ...x, denied: true }))
        else if (e.data?.isError !== true && names.get(e.data?.toolUseId)?.startsWith('devboard_watch_')) {
          setSt((x) => ({ ...x, denied: false }))
          refreshRef.current()
        }
      }
    }
    assistant
      .ensure(storedRef.current)
      .then(() => {
        if (!dead)
          off = assistant.follow(
            onEvent,
            (error) => setSt((x) => ({ ...x, error: `协调员连接中断：${reason(error)}` })),
            () => setSt({ busy: false, denied: false, error: '', failed: '' }),
          )
      })
      .catch((error) => !dead && setSt((x) => ({ ...x, error: `协调员会话无法接回：${reason(error)}` })))
    return () => {
      dead = true
      off?.()
    }
  }, [assistant, sessionId])
  const deliver = React.useCallback(
    async (text) => {
      try {
        await assistant.ensure(storedRef.current)
        await assistant.send(text)
        setSt((x) => ({ ...x, error: '' }))
        return true
      } catch (error) {
        setSt((x) => ({ ...x, error: `协调员没有收到这条消息（可在来龙去脉里重新送交）：${reason(error)}` }))
        return false
      }
    },
    [assistant],
  )
  const recreate = React.useCallback(async () => {
    try {
      await assistant.startNew()
      setSt({ busy: false, denied: false, error: '', failed: '' })
      refreshRef.current()
    } catch (error) {
      setSt((x) => ({ ...x, error: `重建协调员会话失败：${reason(error)}` }))
    }
  }, [assistant])
  const state = st.denied ? 'denied' : st.busy ? 'busy' : st.failed ? 'failed' : sessionId ? 'idle' : 'none'
  return { state, error: st.error || st.failed, perms, queue, deliver, recreate }
}

const Icon = ({ d }) =>
  h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true, className: 'dw-svg' }, h('path', { d }))
const Chip = ({ tone = 'off', children }) => h(Badge, { tone }, children)

/** A tiny index over the records, so rows and the drawer look things up in O(1). */
function useIndex(snap) {
  return React.useMemo(() => {
    const members = new Map(snap.members.map((m) => [m.id, m]))
    const messages = new Map(snap.messages.map((m) => [m.id, m]))
    const decisionOf = new Map(snap.decisions.map((d) => [d.messageId, d]))
    const tickets = new Map(snap.tickets.map((t) => [t.id, t]))
    const rules = new Map(snap.rules.map((r) => [r.id, r]))
    const who = (m) => (m.actor === 'bot' ? '研发协调员' : (members.get(m.actor)?.name ?? m.actor))
    return { members, messages, decisionOf, tickets, rules, who }
  }, [snap])
}

function decisionTag(d, ix) {
  if (!d) return null
  if (d.layer === 'model' && d.verdict === 'pending') return ['待协调员判断', 'warn']
  if (d.verdict === 'route') return [`已送达工单 ${d.ticketId}，未重新判断`, 'info']
  if (d.shadow) return ['只记录 · 未开工', 'warn']
  if (d.verdict === 'accept') return [`工单：${ix.tickets.get(d.ticketId)?.title ?? d.ticketId}`, 'brand']
  if (d.layer === 'model') return [d.verdict === 'ignore' ? '协调员判断：无需处理' : '协调员判断：仅记录', 'off']
  if (d.verdict === 'ignore') return [d.reason, 'off']
  return ['仅记录', 'off']
}

// ── Chat and signal desk ──────────────────────────────────────────────────────────────────────────

function Feed({ snap, ix, open }) {
  const box = React.useRef(null)
  const count = snap.messages.length
  React.useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])
  if (!count) return h('p', { className: 'dw-empty' }, '群里还没有消息。')
  return h(
    'ol',
    { className: 'dw-feed', ref: box, 'aria-live': 'polite', 'aria-label': '项目群消息' },
    snap.messages.map((m) => {
      const d = ix.decisionOf.get(m.id)
      const tag = decisionTag(d, ix)
      return h(
        'li',
        {
          key: m.id,
          className: `dw-msg src-${m.source}${d?.verdict === 'ignore' ? ' dim' : ''}${m.actor === 'bot' ? ' is-bot' : ''}`,
          'data-testid': 'watch-msg',
          'data-verdict': d ? `${d.layer}:${d.verdict}` : '',
        },
        h(
          'button',
          { type: 'button', className: 'dw-msg-btn', onClick: () => open(`msg:${m.id}`) },
          h('span', { className: 'dw-ico', 'aria-label': SRC[m.source] }, h(Icon, { d: SRC_ICON[m.source] })),
          h(
            'span',
            { className: 'dw-msg-body' },
            h('span', { className: 'dw-msg-head' }, h('b', null, safe(ix.who(m))), h('span', null, `${SRC[m.source]} · ${clock(m.at)}`)),
            h('p', null, safe(m.text)),
            tag && h('span', { className: `dw-tag dw-tag-${tag[1]}` }, safe(tag[0])),
          ),
        ),
      )
    }),
  )
}

function Compose({ me, busy, thread, clearThread, onSend }) {
  const [text, setText] = React.useState('')
  const input = React.useRef(null)
  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || !me) return
    if (await onSend({ source: 'im', text: body, ...(thread ? { threadId: thread } : {}) })) {
      setText('')
      clearThread()
    }
  }
  const fill = (value) => {
    setText(value)
    input.current?.focus()
  }
  return h(
    'form',
    { className: 'dw-compose', onSubmit: send },
    h(
      'div',
      { className: 'dw-quick' },
      h('button', { type: 'button', onClick: () => fill('@研发协调员 ') }, '@研发协调员'),
      h('button', { type: 'button', onClick: () => fill('@研发协调员 整理 DEF-0137 关联试验记录') }, '示例：整理试验记录'),
      h('button', { type: 'button', onClick: () => fill('午饭吃什么') }, '示例：闲聊'),
    ),
    thread &&
      h(
        'p',
        { className: 'dw-thread' },
        `回复线程 ${thread}：已立项的线程里的消息直接送达工单`,
        h(Button, { appearance: 'link', onClick: clearThread }, '取消'),
      ),
    h(
      'div',
      { className: 'dw-compose-row' },
      h('input', {
        ref: input,
        className: 'dw-input',
        'aria-label': '在项目群发消息',
        autoComplete: 'off',
        maxLength: 500,
        placeholder: me ? `以 ${safe(me.name)} 的身份发消息，含 @研发协调员 会交给协调员判断` : '先在顶部选择「我是谁」',
        value: text,
        disabled: !me,
        onChange: (e) => setText(e.target.value),
      }),
      h(Button, { htmlType: 'submit', appearance: 'primary', disabled: !me || busy || !text.trim() }, '发送'),
    ),
  )
}

function SignalDesk({ me, busy, onSend, script }) {
  const [src, setSrc] = React.useState('ci')
  const [text, setText] = React.useState('')
  const sources = [
    ['ci', 'CI'],
    ['phm', 'PHM'],
    ['email', '邮件'],
  ]
  return h(
    'div',
    { className: 'dw-desk', 'data-testid': 'watch-desk' },
    h(
      'div',
      { className: 'dw-quick' },
      SIGNALS.map(([s, label, body]) =>
        h('button', { key: label, type: 'button', onClick: () => (setSrc(s), setText(body)) }, label),
      ),
    ),
    h(
      'form',
      {
        className: 'dw-compose-row',
        onSubmit: async (e) => {
          e.preventDefault()
          if (text.trim() && (await onSend({ source: src, text: text.trim() }))) setText('')
        },
      },
      h(Select, {
        'aria-label': '信号来源',
        value: src,
        onChange: setSrc,
        options: sources.map(([value, label]) => ({ value, label })),
        style: { minWidth: 88 },
      }),
      h('input', {
        className: 'dw-input',
        'aria-label': '信号内容',
        autoComplete: 'off',
        maxLength: 500,
        placeholder: '信号内容，例如构建失败、PHM 告警、客户来函',
        value: text,
        onChange: (e) => setText(e.target.value),
      }),
      h(Button, { htmlType: 'submit', disabled: !me || busy || !text.trim() }, '注入信号'),
    ),
    h('p', { className: 'dw-muted' }, '注入的信号与群消息走同一条处理链。'),
    script,
  )
}

// ── Right column ──────────────────────────────────────────────────────────────────────────────────

function NeedRow({ t, me, snap, busy, run, open }) {
  const [reply, setReply] = React.useState(null)
  const n = t.needsHuman
  const wf = n.waitsFor
  const who = wf.memberId ? safe(snap.members.find((m) => m.id === wf.memberId)?.name ?? wf.memberId) : safe(wf.role)
  const act = (name, text) => run('devboard.watch.act', { by: me.id, ticketId: t.id, act: name, ...(text ? { text } : {}) }, '已处理')
  return h(
    'li',
    { className: `dw-need${t.state === 'stalled' ? ' is-stalled' : ''}`, 'data-testid': 'watch-need', 'data-ticket': t.id },
    h(
      'div',
      null,
      h('div', { className: 'dw-need-title' }, safe(t.title)),
      h('div', { className: 'dw-need-sub' }, `等待：`, h('b', null, who), ` · 需要：${safe(n.question)}`),
      h('div', { className: 'dw-muted' }, `${safe(t.role)} · ${safe(t.objectRef)} · ${ago(snap.now, t.progress.at(-1)?.at ?? t.createdAt)}`),
    ),
    h(
      'div',
      { className: 'dw-actions' },
      n.actions.map((a) =>
        h(
          Button,
          {
            key: a.act,
            appearance: a.primary ? 'primary' : undefined,
            disabled: busy,
            onClick: () => (a.act === 'reply' ? setReply(reply === null ? '' : null) : act(a.act)),
          },
          a.label,
        ),
      ),
      h(Button, { appearance: 'link', onClick: () => open(`wi:${t.id}`) }, '查看'),
    ),
    reply !== null &&
      h(
        'form',
        {
          className: 'dw-compose-row',
          onSubmit: async (e) => {
            e.preventDefault()
            if (reply.trim() && (await act('reply', reply.trim()))) setReply(null)
          },
        },
        h('input', { className: 'dw-input', 'aria-label': '回复内容', autoFocus: true, value: reply, maxLength: 500, onChange: (e) => setReply(e.target.value) }),
        h(Button, { htmlType: 'submit', appearance: 'primary', disabled: busy || !reply.trim() }, '发送回复'),
      ),
  )
}

function BoardRow({ kind, item, projectId }) {
  const label = { gate: '评审门', flow: '审批', intervention: '人工介入' }[kind]
  const title = kind === 'gate' ? gateName(item) : (item.title ?? item.ask ?? item.id)
  return h(
    'li',
    { className: 'dw-need', 'data-testid': 'watch-board-need' },
    h(
      'div',
      null,
      h('div', { className: 'dw-need-title' }, h(Chip, null, label), ' ', safe(title)),
      h('div', { className: 'dw-muted' }, safe(item.id)),
    ),
    h('div', { className: 'dw-actions' }, h(Button, { appearance: 'link', onClick: () => jumpTo('devboard-reviews', item.id, ACT_PAGE[kind], projectId) }, '在我的待办中处理')),
  )
}

function PermRow({ entry, queue }) {
  const { tool, kind, title, command, extras } = permissionSummary(entry.req)
  return h(
    'li',
    { className: 'dw-need is-perm', 'data-testid': 'watch-perm' },
    h(
      'div',
      null,
      h('div', { className: 'dw-need-title' }, h(Chip, { tone: 'warn' }, '授权'), ' 协调员请求执行：', tool || kind || '工具调用'),
      h('div', { className: 'dw-need-sub' }, '协调员说明：', title),
    ),
    h(
      'div',
      { className: 'dw-actions' },
      h(Button, { onClick: () => queue.answer(entry, DENY) }, '拒绝'),
      h(Button, { appearance: 'primary', onClick: () => queue.answer(entry, ALLOW) }, '允许一次'),
    ),
    (command || extras.length > 0) && h('pre', { className: 'dw-cmd' }, command || extras.map(([k, v]) => `${k}: ${v}`).join('\n')),
  )
}

function Needs({ snap, ix, me, board, busy, run, open, perms, queue }) {
  if (!me) return h('p', { className: 'dw-empty' }, '先在顶部选择「我是谁」，这里会显示在等你的事。')
  if (snap.needsMember !== me.id) return h('p', { className: 'dw-empty' }, '正在读取…')
  const need = snap.needs ?? { tickets: [], gates: [], flows: [], interventions: [] }
  const byId = (list, ids) => ids.map((id) => list?.find((x) => x.id === id)).filter(Boolean)
  const tickets = need.tickets.map((id) => ix.tickets.get(id)).filter(Boolean)
  const gates = byId(board.data?.gates, need.gates)
  const flows = byId(board.data?.approvals, need.flows)
  const asks = byId(board.data?.interventions, need.interventions)
  const asked = MANAGERS.includes(me.role) ? perms : []
  const total = tickets.length + gates.length + flows.length + asks.length + asked.length
  return h(
    React.Fragment,
    null,
    h('span', { hidden: true, 'data-testid': 'watch-need-count' }, total),
    total
      ? h(
          'ul',
          { className: 'dw-needs' },
          asked.map((entry) => h(PermRow, { key: entry.id, entry, queue })),
          tickets.map((t) => h(NeedRow, { key: t.id, t, me, snap, busy, run, open })),
          flows.map((f) => h(BoardRow, { key: f.id, kind: 'flow', item: f, projectId: snap.projectId })),
          gates.map((g) => h(BoardRow, { key: g.id, kind: 'gate', item: g, projectId: snap.projectId })),
          asks.map((i) => h(BoardRow, { key: i.id, kind: 'intervention', item: i, projectId: snap.projectId })),
        )
      : h('p', { className: 'dw-empty' }, `现在没有需要${safe(me.name)}（${safe(me.role)}）处理的事`),
  )
}

function Funnel({ snap, open }) {
  const f = snap.funnel
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { className: 'dw-funnel' },
      FUNNEL.map(([key, label]) =>
        h(
          'button',
          { key, type: 'button', className: 'dw-stage', 'data-testid': `funnel-${key}`, onClick: () => open(`list:${key}`) },
          h('small', null, label),
          h('strong', null, f[key]),
        ),
      ),
    ),
    h(
      'p',
      { className: 'dw-muted' },
      `进入 = 规则挡掉 ${f.ruleFiltered} + 直送 ${f.routed} + 交给协调员判断 ${f.sentToModel} + 仅记录 ${f.recorded + f.shadow}。`,
      f.pendingModel ? ` 其中 ${f.pendingModel} 条待协调员判断。` : '',
    ),
  )
}

function Lanes({ snap, open }) {
  const by = (s) => snap.tickets.filter((t) => t.state === s)
  const running = by('running')
  const queued = by('queued')
  const stalled = by('stalled')
  const waiting = snap.tickets.filter((t) => ['waiting_human', 'speculative_ready', 'stalled'].includes(t.state))
  const closed = snap.tickets.filter((t) => ['done', 'discarded'].includes(t.state)).length
  return h(
    'section',
    { className: 'dw-card', 'aria-labelledby': 'dw-h-lanes' },
    h(
      'div',
      { className: 'dw-card-head' },
      h('h2', { id: 'dw-h-lanes' }, '子 Agent ', h('span', { className: 'dw-muted' }, `运行 ${running.length} · 排队 ${queued.length} · 停滞 ${stalled.length}`)),
      h(Button, { onClick: () => open('list:closed') }, `历史记录 ${closed}`),
    ),
    h(
      'div',
      { className: 'dw-lanes', 'data-testid': 'watch-lanes' },
      running.length
        ? running.map((t) => h(Lane, { key: t.id, t, open }))
        : h('p', { className: 'dw-empty' }, '没有运行中的子 Agent。'),
    ),
    queued.length > 0 &&
      h(
        'div',
        { className: 'dw-queue' },
        h('span', { className: 'dw-muted' }, '排队：'),
        queued.map((t, i) => h('button', { key: t.id, type: 'button', onClick: () => open(`wi:${t.id}`) }, `${i + 1}. ${safe(t.title)}`)),
      ),
    waiting.length > 0 &&
      h(
        'div',
        { className: 'dw-queue', 'data-testid': 'watch-waiting' },
        h('span', { className: 'dw-muted' }, '等待中：'),
        waiting.map((t) => h('button', { key: t.id, type: 'button', onClick: () => open(`wi:${t.id}`) }, `${safe(t.title)} · ${STATE[t.state][0]}`)),
      ),
    h(
      'p',
      { className: `dw-note${stalled.length ? ' alert' : ''}` },
      stalled.length
        ? `进展巡检：${stalled.map((t) => `「${safe(t.title)}」`).join('、')} 超过 ${snap.stallMinutes} 分钟无新进展，已移入「需要你处理」。`
        : '进展巡检：运行中的子 Agent 均有新进展。',
    ),
  )
}

const Lane = ({ t, open }) =>
  h(
    'button',
    { type: 'button', className: 'dw-lane', onClick: () => open(`wi:${t.id}`) },
    h('span', { className: 'dw-lane-top' }, h(Chip, { tone: 'ok' }, safe(t.role)), h('span', { className: 'dw-pulse', 'aria-hidden': true })),
    h('span', { className: 'dw-lane-title' }, safe(t.title)),
    h('span', { className: 'dw-muted' }, safe(t.objectRef)),
    h('span', { className: 'dw-lane-line' }, safe(t.progress.at(-1)?.line ?? '')),
  )

function Shadow({ snap, ix, open }) {
  const list = snap.decisions.filter((d) => d.shadow)
  return h(
    'section',
    { className: 'dw-card', 'aria-labelledby': 'dw-h-shadow' },
    h('div', { className: 'dw-card-head' }, h('h2', { id: 'dw-h-shadow' }, '只记录 ', h('span', { className: 'dw-count' }, list.length)), h('span', { className: 'dw-muted' }, '影子规则：只记录会做什么，不开工')),
    list.length
      ? h(
          'ul',
          { className: 'dw-mini', 'data-testid': 'watch-shadow' },
          list.map((d) => {
            const m = ix.messages.get(d.messageId)
            return h('li', { key: d.id }, h('button', { type: 'button', onClick: () => open(`msg:${d.messageId}`) }, h('b', null, `${safe(m ? ix.who(m) : '')}：`), safe((m?.text ?? '').slice(0, 40)), h('br'), h('span', { className: 'dw-would' }, safe(d.wouldDo))))
          }),
        )
      : h('p', { className: 'dw-empty' }, '暂无。把某条规则切到「只记录」后，命中的请求会出现在这里。'),
  )
}

// ── Drawer ────────────────────────────────────────────────────────────────────────────────────────

const stateChip = (t) => h(Chip, { tone: STATE[t.state][1] }, STATE[t.state][0])
const Row = ({ children, onClick }) => h('button', { type: 'button', className: 'dw-listrow', onClick }, children)

function MessageBlock({ m, ix }) {
  return h('li', { className: 'dw-k-trigger' }, h('h4', null, `触发 · ${SRC[m.source]}`), h('p', null, h('b', null, safe(ix.who(m))), ' ', h('span', { className: 'dw-muted' }, `${clock(m.at)}${m.mentionsBot ? ' · @协调员' : ''}`)), h('p', null, safe(m.text)), h('p', { className: 'dw-muted' }, `线程 ${m.threadId} · ${m.id}`))
}

const ResendContext = React.createContext(null)

function DecisionBlock({ d, ix, snap }) {
  const resend = React.useContext(ResendContext)
  const rule = d.ruleId ? ix.rules.get(d.ruleId) : null
  const pending = d.layer === 'model' && d.verdict === 'pending'
  return h(
    'li',
    { className: 'dw-k-decision' },
    h('h4', null, '判定'),
    h('p', null, h(Chip, { tone: d.layer === 'rule' ? 'ok' : 'warn' }, d.layer === 'rule' ? '规则层' : '协调员（模型）'), ' ', h(Chip, null, pending ? '待协调员判断' : { ignore: '忽略', record: '记录', route: '直送', accept: '立项' }[d.verdict]), d.shadow && h(Chip, { tone: 'warn' }, '影子模式')),
    h('dl', { className: 'dw-kv' }, h('dt', null, '理由'), h('dd', null, safe(d.reason)), rule && h('dt', null, '规则'), rule && h('dd', null, `${safe(rule.name)} ${d.ruleId}`, rule.kind === 'accept' ? ` · ${rule.mode === 'live' ? '实时' : '只记录'}` : ''), h('dt', null, '判定编号'), h('dd', null, d.id)),
    d.shadow && h('p', { className: 'dw-would' }, `${safe(d.wouldDo)}。未创建工单，没有子 Agent 运行。`),
    pending && h('p', { className: 'dw-would' }, '这条消息已按规则交给协调员，但协调员还没有给出判断；它会留在「待协调员判断」。'),
    pending && resend && h(Button, { onClick: () => resend(d.messageId) }, '重新送交协调员'),
  )
}

function TicketDetail({ t, ix, snap, open, replyIn }) {
  const m = ix.messages.get(t.origin.messageId)
  const d = m && ix.decisionOf.get(m.id)
  const done = t.state === 'done' && t.progress.findLast((p) => p.kind === 'done')
  return h(
    'ol',
    { className: 'dw-tl' },
    m ? h(MessageBlock, { m, ix }) : h('li', null, h('h4', null, '触发'), h('p', { className: 'dw-muted' }, '触发消息已按上限归档。')),
    d && h(DecisionBlock, { d, ix, snap }),
    h('li', { className: 'dw-k-mandate' }, h('h4', null, '工单授权'), h('dl', { className: 'dw-kv' }, h('dt', null, '工单'), h('dd', null, `${safe(t.title)} ${t.id}`), h('dt', null, '对象'), h('dd', null, safe(t.objectRef)), h('dt', null, '角色'), h('dd', null, `${safe(t.role)}${t.speculative ? '（静默起草）' : ''}`), h('dt', null, '授权范围'), h('dd', null, safe(t.mandate.scope)), h('dt', null, '依据规则'), h('dd', null, t.mandate.ruleId ?? '—'))),
    h('li', null, h('h4', null, '子 Agent 进展'), h('ul', { className: 'dw-prog' }, t.progress.map((p, i) => h('li', { key: i, className: `p-${p.kind}` }, h('time', null, clock(p.at)), h('span', null, safe(p.line))))), !['done', 'discarded'].includes(t.state) && h(Button, { onClick: () => replyIn(t.origin.threadId) }, '在此线程回复')),
    h('li', { className: t.needsHuman ? 'dw-k-bad' : 'dw-k-outcome' }, h('h4', null, done ? '结果' : '当前状态'), h('p', null, stateChip(t), done ? ` ${safe(done.line)}` : t.needsHuman ? ` 等待 ${safe(t.needsHuman.waitsFor.role ?? ix.members.get(t.needsHuman.waitsFor.memberId)?.name)}：${safe(t.needsHuman.question)}` : '')),
  )
}

function DrawerBody({ k, snap, ix, open, replyIn }) {
  const [kind, id] = k.split(':')
  if (kind === 'wi') {
    const t = ix.tickets.get(id)
    return t ? h(TicketDetail, { t, ix, snap, open, replyIn }) : h('p', { className: 'dw-muted' }, '工单已不在记录中。')
  }
  if (kind === 'msg') {
    const m = ix.messages.get(id)
    if (!m) return h('p', { className: 'dw-muted' }, '消息已不在记录中。')
    const d = ix.decisionOf.get(id)
    const t = d?.ticketId && ix.tickets.get(d.ticketId)
    return h(
      'ol',
      { className: 'dw-tl' },
      h(MessageBlock, { m, ix }),
      d && h(DecisionBlock, { d, ix, snap }),
      h('li', { className: 'dw-k-outcome' }, h('h4', null, '后续'), t ? h(Row, { onClick: () => open(`wi:${t.id}`) }, h('b', null, safe(t.title)), ' ', stateChip(t)) : h('p', { className: 'dw-muted' }, d?.verdict === 'pending' && d.layer === 'model' ? '等待协调员判断，暂无后续。' : d?.shadow ? '只记录，未开工。' : '没有后续动作，不打扰任何人。')),
    )
  }
  const rule = (d) => d.layer === 'rule'
  const msgRows = (pick) =>
    snap.messages.filter(pick).toReversed().map((m) => {
      const d = ix.decisionOf.get(m.id)
      const tag = decisionTag(d, ix)
      return h(Row, { key: m.id, onClick: () => open(`msg:${m.id}`) }, h('b', null, safe(ix.who(m))), ' ', h('span', { className: 'dw-muted' }, `${SRC[m.source]} · ${clock(m.at)}${tag ? ` · ${safe(tag[0])}` : ''}`), h('br'), safe(m.text))
    })
  const dec = (m, f) => f(ix.decisionOf.get(m.id) ?? {})
  const LISTS = {
    received: ['进入', () => msgRows(() => true)],
    ruleFiltered: ['规则挡掉', () => msgRows((m) => dec(m, (d) => rule(d) && d.verdict === 'ignore'))],
    routed: ['线程直送', () => msgRows((m) => dec(m, (d) => d.verdict === 'route'))],
    sentToModel: ['交给协调员判断', () => msgRows((m) => dec(m, (d) => d.layer === 'model'))],
    interruptions: ['打扰你', () => ticketRows((t) => t.progress.some((p) => p.kind === 'surface'))],
    accepted: ['立项', () => ticketRows(() => true)],
    delivered: ['交付', () => ticketRows((t) => t.state === 'done')],
    closed: ['历史记录（已交付与已丢弃）', () => ticketRows((t) => ['done', 'discarded'].includes(t.state))],
  }
  const ticketRows = (pick) =>
    snap.tickets.filter(pick).toReversed().map((t) => h(Row, { key: t.id, onClick: () => open(`wi:${t.id}`) }, h('b', null, safe(t.title)), ' ', stateChip(t), h('br'), h('span', { className: 'dw-muted' }, `${safe(t.role)} · ${safe(t.objectRef)}`)))
  const rows = LISTS[id]?.[1]() ?? []
  return h('div', { className: 'dw-list', 'data-testid': 'watch-drawer-list' }, rows.length ? rows : h('p', { className: 'dw-muted' }, '暂无'))
}

const drawerTitle = (k, snap) => {
  const [kind, id] = k.split(':')
  if (kind === 'wi') return snap.tickets.find((t) => t.id === id)?.title ?? '工单'
  if (kind === 'msg') return '消息的来龙去脉'
  const label = Object.fromEntries([...FUNNEL, ['closed', '历史记录']])[id] ?? ''
  const n = id === 'closed' ? snap.tickets.filter((t) => ['done', 'discarded'].includes(t.state)).length : snap.funnel[id]
  return `${label}（${n ?? 0}）`
}

function Settings({ snap, me, busy, run }) {
  const manager = me && ['项目经理', '技术负责人'].includes(me.role)
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState('机械设计师')
  const roles = React.useMemo(() => [...new Set(['项目经理', '技术负责人', '质量工程师', '验证工程师', '机械设计师', '电气设计师', '软件设计师', '系统设计师', '配置管理员', '诊断工程师', '客户代表', ...snap.members.map((m) => m.role)])], [snap.members])
  return h(
    'div',
    { className: 'dw-settings', 'data-testid': 'watch-settings' },
    h('h3', null, '可切换规则'),
    !manager && h('p', { className: 'dw-muted' }, '只有项目经理和技术负责人可以切换规则、调整成员。'),
    snap.rules.filter((r) => r.kind === 'accept').map((r) => h('div', { key: r.id, className: 'dw-rule' }, h('div', null, h('div', { className: 'dw-rule-name' }, safe(r.name)), h('div', { className: 'dw-muted' }, `${safe(r.desc)} · 命中 ${r.hits} 次`)), h(Button, { role: 'switch', 'aria-checked': r.mode === 'live', 'aria-label': `${r.name}：${r.mode === 'live' ? '实时' : '只记录'}`, disabled: !manager || busy, onClick: () => run('devboard.watch.rule', { by: me.id, ruleId: r.id, mode: r.mode === 'live' ? 'shadow' : 'live' }, '规则模式已更新') }, r.mode === 'live' ? '实时' : '只记录'))),
    h('h3', null, '常驻过滤（不可关）'),
    snap.rules.filter((r) => r.kind !== 'accept').map((r) => h('div', { key: r.id, className: 'dw-rule' }, h('div', null, h('div', { className: 'dw-rule-name' }, safe(r.name)), h('div', { className: 'dw-muted' }, `命中 ${r.hits} 次`)), h(Chip, null, '常驻'))),
    h('h3', null, `群成员 ${snap.members.length}`),
    snap.members.map((m) => h('div', { key: m.id, className: 'dw-rule' }, h('div', null, h('div', { className: 'dw-rule-name' }, safe(m.name)), h('div', { className: 'dw-muted' }, safe(m.role))), manager && m.id !== me.id && h(Button, { disabled: busy, onClick: () => run('devboard.watch.member', { by: me.id, op: 'remove', memberId: m.id }, '已移除成员') }, '移除'))),
    manager &&
      h('form', { className: 'dw-compose-row', onSubmit: async (e) => { e.preventDefault(); if (name.trim() && (await run('devboard.watch.member', { by: me.id, op: 'add', name: name.trim(), role }, '已添加成员'))) setName('') } }, h('input', { className: 'dw-input', 'aria-label': '新成员姓名', value: name, maxLength: 24, placeholder: '新成员姓名', onChange: (e) => setName(e.target.value) }), h(Select, { 'aria-label': '新成员角色', value: role, onChange: setRole, options: roles.map((r) => ({ value: r, label: r })), style: { minWidth: 130 } }), h(Button, { htmlType: 'submit', disabled: busy || !name.trim() }, '添加')),
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────────

export function Watch({ ctx, board }) {
  const projects = board.data?.projects ?? []
  const saved = (() => {
    try {
      return window.sessionStorage.getItem('devboard.project')
    } catch {
      return null
    }
  })()
  const [picked, setPicked] = React.useState(() => store('devboard.watch.project') ?? saved)
  const projectId = projects.some((p) => p.id === picked) ? picked : (projects.find((p) => p.id === saved)?.id ?? projects[0]?.id ?? '')
  const [meId, setMeId] = React.useState(() => store(`devboard.watch.me.${projectId}`) ?? '')
  const [deskOpen, setDeskOpen] = React.useState(false)
  const [stack, setStack] = React.useState([])
  const [thread, setThread] = React.useState('')
  const [settings, setSettings] = React.useState(false)
  // The stored identity belongs to a project; switching project reads that project's own choice.
  React.useEffect(() => setMeId(store(`devboard.watch.me.${projectId}`) ?? ''), [projectId])
  const { snap, error, notice, busy, run, load } = useWatch(ctx, projectId, meId)
  if (!projectId || !snap)
    return h('div', { className: 'devboard-frame' }, h('div', { className: 'devboard-watch' }, h('p', { className: 'devboard-assistant-loading' }, error || '正在读取值守记录…')))
  const me = snap.members.find((m) => m.id === meId)
  return h(WatchView, { ctx, board, snap, me, projects, projectId, error, notice, busy, run, load, deskOpen, setDeskOpen, stack, setStack, thread, setThread, settings, setSettings, pickProject: (id) => (store('devboard.watch.project', id), setPicked(id)), pickMe: (id) => (store(`devboard.watch.me.${projectId}`, id), setMeId(id)) })
}

function WatchView(p) {
  const { snap, me, board, projectId, busy, stack, setStack } = p
  const ix = useIndex(snap)
  const co = useCoordinator(p.ctx, projectId, snap.session, p.load)
  const latest = React.useRef(snap)
  latest.current = snap
  const open = (k) => setStack((s) => [...s, k])
  const close = () => setStack([])
  // A message the rules handed over (or a follow-up on a live ticket) is forwarded to the group's coordinator session.
  const forward = (message, decision) => co.deliver(coordinatorBrief(latest.current, message, decision))
  // The one way a message or signal enters the group: a typed line, a signal-desk click and a script event all come through here.
  const post = async (input) => {
    if (!me) return null
    const out = await p.run('devboard.watch.post', { by: me.id, ...input }, input.source === 'im' ? '已发送' : '信号已注入')
    const d = out?.decision
    if (d && ((d.layer === 'model' && d.verdict === 'pending') || d.verdict === 'route')) await forward(out.message, d)
    return out
  }
  const send = async (input) => Boolean(await post(input))
  const player = useScriptPlayer({ services: p.ctx.profile.services, projectId, post })
  const manager = Boolean(me) && MANAGERS.includes(me.role)
  const resetAll = async () => {
    const out = await p.run('devboard.watch.reset', { by: me.id }, '值守记录已重置')
    if (out) player.clear()
    return Boolean(out)
  }
  // A person's action on a ticket goes back to the coordinator, which closes the loop.
  const run = async (service, input, done) => {
    const label = service === 'devboard.watch.act' ? latest.current.tickets.find((t) => t.id === input.ticketId)?.needsHuman?.actions.find((a) => a.act === input.act)?.label : undefined
    const out = await p.run(service, input, done)
    if (out?.ticket && service === 'devboard.watch.act') await co.deliver(humanActBrief(latest.current, out.ticket, { by: input.by, act: input.act, label, text: input.text }))
    return out
  }
  const resend = (messageId) => {
    const message = latest.current.messages.find((m) => m.id === messageId)
    const decision = latest.current.decisions.find((d) => d.messageId === messageId)
    if (message && decision) void forward(message, decision)
  }
  const k = stack.at(-1)
  return h(
    'div',
    { className: 'devboard-frame' },
    h(
      'div',
      { className: 'devboard-watch', 'data-testid': 'watch-page' },
      h(
        'header',
        { className: 'dw-top' },
        h('div', { className: 'dw-title' }, h('h1', null, '值守中心'), h('span', { className: 'dw-demo' }, '演示 · 模拟信号源')),
        h('div', { className: 'dw-kpi', 'aria-live': 'polite', 'data-testid': 'watch-kpi' }, '本次值守：Agent 打扰你 ', h('b', null, snap.funnel.interruptions), ' 次 · 交付 ', h('b', null, snap.funnel.delivered), ' 项'),
        (player.phase === 'playing' || player.phase === 'paused') &&
          h('span', { className: 'dw-coord', 'data-testid': 'watch-script-status', 'data-state': player.phase }, `剧本 ${player.cursor}/${player.total} · ${player.phase === 'playing' ? `${player.speed}x` : '已暂停'}`),
        h('span', { className: 'dw-coord', 'data-testid': 'watch-coordinator', 'data-state': co.state }, h('span', { className: 'dw-pulse', 'aria-hidden': true }), `协调员：${{ none: '未启动', idle: '待命', busy: '处理中…', failed: '上一轮失败', denied: '需要重建' }[co.state]}`),
        h(
          'div',
          { className: 'dw-controls' },
          h(Select, { 'aria-label': '项目群', value: projectId, onChange: p.pickProject, options: snap.projects.map((x) => ({ value: x.id, label: `${x.id} ${safe(x.name)}` })), style: { minWidth: 240 } }),
          h(Select, { 'aria-label': '我是谁', virtual: false, value: me?.id ?? '', onChange: p.pickMe, options: [{ value: '', label: '我是谁：请选择' }, ...snap.members.map((m) => ({ value: m.id, label: `我是谁：${safe(m.name)} · ${safe(m.role)}` }))], style: { minWidth: 210 } }),
          h(Button, { 'aria-expanded': p.deskOpen, 'aria-controls': 'dw-desk', onClick: () => p.setDeskOpen(!p.deskOpen) }, '信号台'),
          h(Button, { onClick: () => p.setSettings(true) }, '规则与成员'),
        ),
      ),
      p.error && h('div', { className: 'dw-banner is-error', role: 'alert' }, safe(p.error)),
      co.error && h('div', { className: 'dw-banner is-error', role: 'alert', 'data-testid': 'watch-coord-error' }, safe(co.error)),
      co.state === 'denied' && h('div', { className: 'dw-banner is-error', role: 'alert', 'data-testid': 'watch-denied' }, '协调员会话已失去值守记录的访问权限（插件热重载后会这样），它现在无法判断和记录。', h(Button, { onClick: co.recreate }, '重建协调员会话')),
      p.notice && !p.error && h('div', { className: 'dw-banner', role: 'status' }, safe(p.notice)),
      h(
        'div',
        { className: 'dw-layout' },
        h(
          'section',
          { className: 'dw-card dw-chat', 'aria-labelledby': 'dw-h-chat' },
          h('div', { className: 'dw-card-head' }, h('h2', { id: 'dw-h-chat' }, '项目群聊 ', h('span', { className: 'dw-muted' }, safe(snap.projects.find((x) => x.id === projectId)?.name ?? ''))), h('span', { className: 'dw-count', 'data-testid': 'watch-msg-count' }, snap.messages.length)),
          h(Feed, { snap, ix, open }),
          p.deskOpen && h('div', { id: 'dw-desk' }, h(SignalDesk, { me, busy, onSend: send, script: h(ScriptPanel, { player, me, manager, busy, reset: resetAll }) })),
          h(Compose, { me, busy, thread: p.thread, clearThread: () => p.setThread(''), onSend: send }),
        ),
        h(
          'div',
          { className: 'dw-main' },
          h('section', { className: 'dw-card dw-need-card', 'aria-labelledby': 'dw-h-need' }, h('p', { className: 'dw-q' }, '① 现在要我做什么？'), h('div', { className: 'dw-card-head' }, h('h2', { id: 'dw-h-need' }, '需要你处理')), h(Needs, { snap, ix, me, board, busy, run, open, perms: co.perms, queue: co.queue })),
          h('section', { className: 'dw-card', 'aria-labelledby': 'dw-h-funnel' }, h('p', { className: 'dw-q' }, '② 系统在做什么？'), h('div', { className: 'dw-card-head' }, h('h2', { id: 'dw-h-funnel' }, '值守漏斗'), h('span', { className: 'dw-muted' }, '点数字看明细')), h(Funnel, { snap, open })),
          h(Lanes, { snap, open }),
          h(Shadow, { snap, ix, open }),
          h('p', { className: 'dw-muted' }, '③ 一件事的来龙去脉：点击任意消息、工单或数字，从右侧抽屉查看。'),
        ),
      ),
      h(Drawer, { open: Boolean(k), title: k ? drawerTitle(k, snap) : '', onClose: close }, k && h(ResendContext.Provider, { value: resend }, h(React.Fragment, null, stack.length > 1 && h(Button, { onClick: () => setStack(stack.slice(0, -1)) }, '返回'), h(DrawerBody, { k, snap, ix, open, replyIn: (t) => (p.setThread(t), close()) })))),
      h(Drawer, { open: p.settings, title: '规则与成员', onClose: () => p.setSettings(false) }, p.settings && h(Settings, { snap, me, busy, run })),
    ),
  )
}
