import data from './assistant-run.js'

/**
 * 「小川演示」: replays one real run of the 小川 assistant (new project to release) from the compact timeline in
 * assistant-run.js (written by scripts/assistant-demo-export.mjs). Same mechanism as watch-center.js: markup and CSS
 * for a shadow root (constructable stylesheet, no inline style attributes, no inline scripts: the host CSP forbids
 * them) and run(root) for the player. Only the data differs; nothing here talks to the live board.
 */
export const css = String.raw`
:host{display:block;color-scheme:light;--bg:#f3f3f1;--surface:#fff;--sub:#f8f8f6;--line:#e4e4e0;--line2:#ecece8;--fill:#f3f3f1;--text:#1b1d22;--text2:#4b4f58;--text3:#666b76;--brand:#4f5bd5;--brand-bg:#eef0fc;--brand-line:#d9dcf7;--ok:#25784a;--ok-bg:#e6f3eb;--warn:#8a5a10;--warn-bg:#f7eedd;--bad:#b23a34;--bad-bg:#fae9e7;--info:#2563a8;--info-bg:#e8f0f9;--shadow:0 12px 40px rgb(20 22 30 / 18%)}
:host([data-dark]){color-scheme:dark;--bg:#16171b;--surface:#22242a;--sub:#1c1e23;--line:#33353c;--line2:#2b2d33;--fill:#2b2d33;--text:#ececea;--text2:#b8bac2;--text3:#9a9ea8;--brand:#8a93ff;--brand-bg:#2a2d4a;--brand-line:#3a3f6b;--ok:#6fcf97;--ok-bg:#1f3328;--warn:#e0b25c;--warn-bg:#3a2f1a;--bad:#f0a39e;--bad-bg:#4a1f1d;--info:#7db3e8;--info-bg:#1d2d42;--shadow:0 12px 40px rgb(0 0 0 / 50%)}
*{box-sizing:border-box}
[hidden]{display:none!important}
:host{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}
header.top,.stages,.layout{color:var(--text);font:inherit}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.mono{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:12.5px}
.muted{color:var(--text3);font-size:12px}
header.top{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px}
.title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.title h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.01em}
.demo{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;background:var(--info-bg);color:var(--info);font-size:12px;white-space:nowrap}
.demo::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--info)}
.kpis{display:flex;flex-wrap:wrap;gap:4px 18px;margin-left:auto;font-size:13px;color:var(--text2)}
.kpis b{font-size:17px;font-weight:650;color:var(--brand);padding:0 2px}
.kpis small{color:var(--text3);font-size:12px}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%}
.btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover{border-color:var(--text3)}
.to-latest{position:absolute;right:18px;bottom:16px;z-index:2;box-shadow:0 2px 10px rgba(0,0,0,.14)}
.to-latest[hidden]{display:none}
.btn-primary{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600;min-width:76px;justify-content:center}
:host([data-dark]) .btn-primary{color:#14152a}
.btn-primary:hover{filter:brightness(1.08);border-color:var(--brand)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
.seg button{border:0;background:transparent;height:30px;padding:0 10px;font-size:13px;color:var(--text2)}
.seg button[aria-pressed=true]{background:var(--brand-bg);color:var(--brand);font-weight:600}
.scrub{flex:1;min-width:160px;accent-color:var(--brand)}
.clock{font-size:12px;color:var(--text3);white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line2)}
.card-head h2{margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
.count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:999px;background:var(--fill);color:var(--text2);font-size:12px;font-weight:600}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--fill);color:var(--text2)}
.chip-ok{background:var(--ok-bg);color:var(--ok)}.chip-warn{background:var(--warn-bg);color:var(--warn)}.chip-bad{background:var(--bad-bg);color:var(--bad)}.chip-info{background:var(--info-bg);color:var(--info)}.chip-brand{background:var(--brand-bg);color:var(--brand)}
.stages{margin:16px 24px 0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));overflow:hidden}
.stage{padding:12px 14px;border-right:1px solid var(--line2);min-width:0}
.stage:last-child{border-right:0}
.stage-name{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600}
.stage-gate{margin-top:6px;font-size:12px;color:var(--text3);min-height:36px}
.stage-gate b{color:var(--text2);font-weight:600}
.stage-bar{height:3px;border-radius:2px;background:var(--line2);margin-top:8px}
.stage-bar i{display:block;height:100%;border-radius:2px;background:var(--brand);width:0}
.stage[data-state=PASSED] .stage-bar i{width:100%;background:var(--ok)}
.stage[data-state=IN_REVIEW] .stage-bar i{width:75%;background:var(--warn)}
.stage[data-state=IN_PROGRESS] .stage-bar i{width:40%}
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);gap:16px;padding:16px 24px 40px;align-items:start}
.chat{position:relative;display:flex;flex-direction:column;height:calc(100vh - 250px);min-height:460px}
.feed{overflow:auto;flex:1;min-height:0;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.empty{padding:28px 16px;color:var(--text3);font-size:13px;text-align:center}
.turn{display:flex;align-items:center;gap:10px;color:var(--text3);font-size:12px;margin-top:6px}
.turn::before,.turn::after{content:"";height:1px;background:var(--line2);flex:1}
.bubble{max-width:86%;padding:9px 13px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px}
.bubble-user{align-self:flex-end;background:var(--brand-bg);border:1px solid var(--brand-line)}
.bubble-bot{align-self:flex-start;background:var(--sub);border:1px solid var(--line2)}
.who{display:block;font-size:11.5px;color:var(--text3);margin-bottom:2px}
.sys{align-self:center;font-size:12px;color:var(--text2);background:var(--fill);border-radius:999px;padding:2px 12px}
.tools{align-self:stretch;border-left:2px solid var(--line);padding-left:10px;font-size:12px;color:var(--text3)}
.tools-head{background:none;border:0;padding:0;color:var(--text2);font-size:12px}
.tools ul{list-style:none;margin:2px 0 0;padding:0}
.tools li{padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tools li.err{color:var(--bad)}
.tools:not(.open) li:not(:nth-last-child(-n+3)){display:none}
.note{align-self:stretch;display:flex;flex-direction:column;gap:3px;border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--surface);font-size:13px}
.note-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.note-head strong{font-weight:600}
.note-body{color:var(--text2);font-size:12.5px;overflow-wrap:anywhere}
.note-ok{border-color:var(--ok)}.note-warn{border-color:var(--warn)}.note-bad{border-color:var(--bad)}.note-info{border-color:var(--info)}
.side{display:flex;flex-direction:column;gap:16px;min-width:0}
.side ul{list-style:none;margin:0;padding:6px 0}
.side li{padding:7px 16px;border-top:1px solid var(--line2);display:flex;flex-direction:column;gap:2px;font-size:13px}
.side li:first-child{border-top:0}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.row span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side-empty{padding:14px 16px;color:var(--text3);font-size:13px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:12px 16px;font-size:13px;color:var(--text2)}
.facts b{color:var(--text);font-weight:650}
@media (max-width:980px){.layout{grid-template-columns:1fr}.chat{height:70vh}.stages{grid-template-columns:repeat(3,minmax(0,1fr))}.stage:nth-child(3){border-right:0}}
`

export const html = String.raw`
<header class="top">
  <div class="title"><h1>小川演示</h1><span class="demo">回放 · 真实运行快照</span><span class="muted" id="proj"></span></div>
  <div class="kpis" id="kpis"></div>
  <div class="controls">
    <button class="btn btn-primary" id="play" type="button">播放</button>
    <button class="btn" id="restart" type="button">重播</button>
    <span class="seg" id="speed" role="group" aria-label="播放速度"></span>
    <input class="scrub" id="scrub" type="range" min="0" value="0" step="1" aria-label="时间轴">
    <span class="clock" id="clock"></span>
  </div>
</header>
<section class="card stages" id="stages" aria-label="阶段"></section>
<div class="layout">
  <section class="card chat">
    <div class="card-head"><h2>对话与动作 <span class="count" id="n-feed">0</span></h2><span class="chip" id="status">待开始</span></div>
    <div class="feed" id="feed" role="log" tabindex="0"></div>
    <button class="btn to-latest" id="to-latest" type="button" hidden>回到最新 ↓</button>
  </section>
  <aside class="side">
    <section class="card"><div class="card-head"><h2>全程摘要</h2></div><div class="facts" id="facts"></div></section>
    <section class="card"><div class="card-head"><h2>评审门与签署 <span class="count" id="n-gates">0</span></h2></div><ul id="gates"></ul></section>
    <section class="card"><div class="card-head"><h2>派出的角色 <span class="count" id="n-roles">0</span></h2></div><ul id="roles"></ul></section>
    <section class="card"><div class="card-head"><h2>交付物 <span class="count" id="n-arts">0</span></h2></div><ul id="arts"></ul></section>
    <section class="card"><div class="card-head"><h2>缺陷 <span class="count" id="n-defs">0</span></h2></div><ul id="defs"></ul></section>
    <section class="card"><div class="card-head"><h2>测试执行 <span class="count" id="n-tests">0</span></h2></div><ul id="tests"></ul></section>
  </aside>
</div>
`

const STAGE_NAMES = { INITIATION: '概念', REQUIREMENTS: '需求', DESIGN: '设计', IMPLEMENTATION: '开发', VERIFICATION: '验证', RELEASE: '发布' }
const STATE_LABEL = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', IN_REVIEW: '评审中', PASSED: '已通过', REWORK: '返工' }
const STATE_CHIP = { NOT_STARTED: '', IN_PROGRESS: 'chip-brand', IN_REVIEW: 'chip-warn', PASSED: 'chip-ok', REWORK: 'chip-bad' }
const DEFECT_LABEL = { NEW: '新建', CONFIRMED: '已确认', FIXING: '修复中', RETEST: '待复测', CLOSED: '已关闭' }
const OPTION_LABEL = { 'allowed-once': '允许一次', denied: '拒绝', 'allowed-session': '本会话允许' }
const SPEEDS = [60, 120, 300, 600]
const STAGE_CODES = data.meta.stages
const TOTAL = data.stats.durationSec

const pad = (n) => String(n).padStart(2, '0')
const fmt = (s) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`
const mins = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分` : `${Math.round(s / 60)} 分`)

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}
const chip = (text, tone) => el('span', `chip${tone ? ` ${tone}` : ''}`, text)

export function run(root) {
  const $ = (id) => root.getElementById(id)
  const feed = $('feed')
  let T = 0
  let idx = 0
  let speed = 60
  let follow = true
  let userAt = 0
  let held = false
  let playing = false
  let timer = 0
  let state = fresh()

  function fresh() {
    return {
      turn: 0,
      busy: false,
      feedCount: 0,
      tools: 0,
      stages: Object.fromEntries(STAGE_CODES.map((c) => [c, { state: 'NOT_STARTED', gate: null }])),
      gates: [],
      roles: new Map(),
      arts: [],
      defects: new Map(),
      tests: [],
      perms: new Map(),
      permAsked: 0,
      group: null,
    }
  }

  const clearEmpty = () => {
    if (feed.firstChild?.className === 'empty') feed.firstChild.remove()
  }
  const push = (node) => {
    clearEmpty()
    state.group = null
    feed.append(node)
    state.feedCount++
  }
  const note = (tone, head, body) => {
    const box = el('div', `note note-${tone}`)
    const h = el('div', 'note-head')
    for (const x of head) h.append(x)
    box.append(h)
    if (body) box.append(el('div', 'note-body', body))
    return box
  }
  const gateOf = (id) => state.gates.find((g) => g.id === id)

  function apply(ev) {
    clearEmpty()
    switch (ev.k) {
      case 'turn':
        state.turn = ev.n
        state.busy = true
        push(el('div', 'turn', `第 ${ev.n} 轮 · ${fmt(ev.t)}`))
        break
      case 'turn-end':
        state.busy = false
        break
      case 'user': {
        const b = el('div', 'bubble bubble-user')
        b.append(el('span', 'who', '你'), document.createTextNode(ev.text))
        push(b)
        break
      }
      case 'handback':
        push(el('div', 'sys', `自动交回 · ${ev.text}`))
        break
      case 'reply': {
        const b = el('div', 'bubble bubble-bot')
        b.append(el('span', 'who', '小川'), document.createTextNode(ev.text))
        push(b)
        break
      }
      case 'tool': {
        state.tools++
        if (!state.group) {
          const g = el('div', 'tools')
          const head = el('button', 'tools-head')
          head.type = 'button'
          g.append(head, el('ul'))
          const grp = { node: g, head, list: g.lastChild, n: 0 }
          grp.sync = () => {
            head.textContent = `工具调用 ×${grp.n} · ${g.classList.contains('open') ? '收起' : '展开'}`
          }
          head.addEventListener('click', () => {
            g.classList.toggle('open')
            grp.sync()
          })
          feed.append(g)
          state.feedCount++
          state.group = grp
        }
        const grp = state.group
        const li = el('li', ev.err ? 'err mono' : 'mono', ev.hint ? `${ev.label} · ${ev.hint}` : ev.label)
        if (ev.err) li.append(document.createTextNode('（失败）'))
        grp.list.append(li)
        grp.n++
        grp.sync()
        break
      }
      case 'spawn': {
        const r = state.roles.get(ev.role) ?? { title: ev.title, runs: 0, active: false }
        r.runs++
        r.active = true
        state.roles.set(ev.role, r)
        push(note('info', [chip('派出角色', 'chip-info'), el('strong', '', ev.title)], ev.task))
        break
      }
      case 'role-result': {
        const r = state.roles.get(ev.role)
        if (r) r.active = false
        push(note('info', [chip('角色回报', 'chip-info'), el('strong', '', ev.title)], ev.text))
        break
      }
      case 'artifact':
        state.arts.push(ev)
        push(note('ok', [chip(`交付物 · ${ev.kind}`, 'chip-ok'), el('strong', 'mono', ev.path), chip(`v${ev.version}`)], ev.title))
        break
      case 'stage':
        if (state.stages[ev.stage] && ev.state) state.stages[ev.stage].state = ev.state
        break
      case 'gate': {
        state.gates.push({ ...ev, decision: 'PENDING' })
        if (state.stages[ev.stage]) state.stages[ev.stage].gate = ev.code
        const who = ev.auto ? '自动门' : `待 ${(ev.roles ?? []).join('、')} 决议`
        push(note('warn', [chip(`提交评审门 ${ev.code}`, 'chip-warn'), el('strong', '', ev.name)], who))
        break
      }
      case 'gate-decision': {
        let g = gateOf(ev.id)
        if (!g) {
          g = { id: ev.id, code: ev.code, name: ev.name, stage: '', roles: [] }
          state.gates.push(g)
        }
        g.decision = ev.decision
        g.by = ev.by
        g.kind = ev.kind
        g.signers = ev.signers
        const ok = ev.decision === 'APPROVED'
        const stage = state.stages[g.stage]
        if (stage) {
          stage.state = ok ? 'PASSED' : 'REWORK'
          stage.gate = ev.code
          stage.by = ev.by
          stage.kind = ev.kind
        }
        const sign = ev.kind === 'human' ? `${ev.by} 在看板上签署` : ev.by
        push(note(ok ? 'ok' : 'bad', [chip(`${ev.code} ${ok ? '已批准' : '未通过'}`, ok ? 'chip-ok' : 'chip-bad'), el('strong', '', ev.name)], sign))
        break
      }
      case 'defect': {
        state.defects.set(ev.id, ev)
        const closed = ev.state === 'CLOSED'
        push(note(closed ? 'ok' : 'bad', [chip(`${ev.id} · ${DEFECT_LABEL[ev.state] ?? ev.state}`, closed ? 'chip-ok' : 'chip-bad'), el('strong', '', ev.title)], `${ev.severity ?? ''} 类缺陷 · ${ev.by ?? ''}`))
        break
      }
      case 'test':
        state.tests.push(ev)
        push(note('info', [chip(`测试执行 ${ev.id}`, 'chip-info'), el('strong', '', `${ev.passed}/${ev.total} 通过`)], `失败 ${ev.failed} · 跳过 ${ev.skipped} · ${ev.level}`))
        break
      case 'perm': {
        state.permAsked++
        const status = chip('待你授权', 'chip-warn')
        const box = note('warn', [chip(`授权请求 · ${ev.label}`, 'chip-warn'), status])
        if (ev.cmd) box.append(el('div', 'note-body mono', ev.cmd))
        state.perms.set(ev.id, { status, box })
        push(box)
        break
      }
      case 'perm-answer': {
        const p = state.perms.get(ev.id)
        if (p) {
          const deny = ev.option === 'denied'
          p.status.textContent = `${OPTION_LABEL[ev.option] ?? ev.option} · 所有者`
          p.status.className = `chip ${deny ? 'chip-bad' : 'chip-ok'}`
          p.box.className = `note note-${deny ? 'bad' : 'ok'}`
        }
        break
      }
      default:
    }
  }

  const list = (id, items, empty, build) => {
    const ul = $(id)
    ul.replaceChildren()
    if (!items.length) {
      const li = el('li', 'side-empty', empty)
      ul.append(li)
      return
    }
    for (const it of items) ul.append(build(it))
  }
  const rowOf = (left, right, sub) => {
    const li = el('li')
    const r = el('div', 'row')
    r.append(el('span', '', left), right)
    li.append(r)
    if (sub) li.append(el('span', 'muted', sub))
    return li
  }

  function renderPanels() {
    const s = state
    const stages = $('stages')
    stages.replaceChildren()
    for (const code of STAGE_CODES) {
      const st = s.stages[code]
      const box = el('div', 'stage')
      box.dataset.state = st.state
      const name = el('div', 'stage-name')
      name.append(el('span', '', STAGE_NAMES[code] ?? code), chip(STATE_LABEL[st.state] ?? st.state, STATE_CHIP[st.state]))
      const gate = el('div', 'stage-gate')
      if (st.gate) {
        gate.append(el('b', '', st.gate))
        if (st.by) gate.append(document.createTextNode(st.kind === 'human' ? ` · ${st.by} 已签署` : ` · ${st.by}`))
        else gate.append(document.createTextNode(' · 等待决议'))
      }
      const bar = el('div', 'stage-bar')
      bar.append(el('i'))
      box.append(name, gate, bar)
      stages.append(box)
    }
    const gates = s.gates
    $('n-gates').textContent = String(gates.filter((g) => g.decision && g.decision !== 'PENDING').length)
    // a pending gate followed by a later one with the same code was sent back by its review meeting and resubmitted
    const resubmitted = new Set(gates.filter((g, i) => gates.slice(i + 1).some((x) => x.code === g.code)))
    list('gates', gates, '尚未提交评审门', (g) => {
      const done = g.decision && g.decision !== 'PENDING'
      const ok = g.decision === 'APPROVED'
      if (!done && resubmitted.has(g)) return rowOf(`${g.code} ${g.name}`, chip('已重提'), '评审会驳回后重新提交')
      const sub = done ? (g.kind === 'human' ? `${g.by} 签署` : g.by) : g.auto ? '自动门' : `待 ${(g.roles ?? []).join('、')}`
      return rowOf(`${g.code} ${g.name}`, chip(done ? (ok ? '已通过' : '未通过') : '评审中', done ? (ok ? 'chip-ok' : 'chip-bad') : 'chip-warn'), sub)
    })
    $('n-roles').textContent = String(s.roles.size)
    list('roles', [...s.roles.values()], '尚未派出角色', (r) => rowOf(r.title, chip(r.active ? '工作中' : '待命', r.active ? 'chip-brand' : ''), `派出 ${r.runs} 次`))
    $('n-arts').textContent = String(s.arts.length)
    list('arts', s.arts.slice(-8).reverse(), '尚无交付物', (a) => rowOf(a.title, chip(a.kind), a.path))
    $('n-defs').textContent = String(s.defects.size)
    list('defs', [...s.defects.values()], '尚无缺陷', (d) => rowOf(`${d.id} ${d.title}`, chip(DEFECT_LABEL[d.state] ?? d.state, d.state === 'CLOSED' ? 'chip-ok' : 'chip-bad'), `${d.severity ?? ''} 类`))
    $('n-tests').textContent = String(s.tests.length)
    list('tests', s.tests.slice().reverse(), '尚无测试执行', (t) => rowOf(t.id, chip(`${t.passed}/${t.total}`, t.failed ? 'chip-bad' : 'chip-ok'), `失败 ${t.failed} · 跳过 ${t.skipped}`))
    $('n-feed').textContent = String(s.feedCount)
    const status = $('status')
    status.textContent = s.busy ? '小川处理中' : s.turn ? '等待你' : '待开始'
    status.className = `chip ${s.busy ? 'chip-brand' : s.turn ? 'chip-warn' : ''}`
    const decided = s.gates.filter((g) => g.decision && g.decision !== 'PENDING').length
    const k = $('kpis')
    k.replaceChildren()
    const kpi = (label, now, total) => {
      const span = el('span')
      span.append(document.createTextNode(`${label}`), el('b', '', String(now)), el('small', '', `/ ${total}`))
      k.append(span)
    }
    kpi('轮次', s.turn, data.stats.turns)
    kpi('工具', s.tools, data.stats.toolCalls)
    kpi('评审门', decided, data.stats.gates)
    kpi('角色', s.roles.size, data.stats.roles)
    kpi('缺陷', s.defects.size, data.stats.defects)
    kpi('授权', s.permAsked, data.stats.permissions)
    $('clock').textContent = `${fmt(T)} / ${fmt(TOTAL)}`
    $('scrub').value = String(Math.floor(T))
    $('play').textContent = playing ? '暂停' : T >= TOTAL ? '重播' : '播放'
  }

  function setFollow(on) {
    follow = on
    $('to-latest').hidden = on
  }

  function advance(to) {
    const ev = data.events
    let moved = false
    while (idx < ev.length && ev[idx].t <= to) {
      apply(ev[idx++])
      moved = true
    }
    if (moved && follow) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      feed.scrollTo({ top: feed.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    }
    renderPanels()
  }

  function seek(to) {
    const target = Math.max(0, Math.min(TOTAL, to))
    if (target < T || (target === 0 && idx > 0)) {
      feed.replaceChildren()
      state = fresh()
      idx = 0
      setFollow(true)
    }
    T = target
    advance(T)
  }

  function setPlaying(on) {
    playing = on
    clearInterval(timer)
    if (on) {
      if (T >= TOTAL) seek(0)
      timer = setInterval(() => {
        T = Math.min(TOTAL, T + 0.1 * speed)
        advance(T)
        if (T >= TOTAL) setPlaying(false)
      }, 100)
    }
    renderPanels()
  }

  // Follow the newest line until the user scrolls away; only user-initiated scrolls flip `follow`, so the playback's own
  // smooth scrolling never does. Scrolling back near the bottom resumes following.
  const touched = () => {
    userAt = Date.now()
  }
  feed.addEventListener('wheel', touched, { passive: true })
  feed.addEventListener('touchmove', touched, { passive: true })
  feed.addEventListener('pointerdown', () => {
    held = true
  })
  const release = () => {
    held = false
    touched()
  }
  window.addEventListener('pointerup', release)
  feed.addEventListener('keydown', touched)
  feed.addEventListener('scroll', () => {
    if (!held && Date.now() - userAt > 400) return
    setFollow(feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48)
  })
  const latest = $('to-latest')
  latest.addEventListener('click', () => {
    setFollow(true)
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' })
  })
  const sp = $('speed')
  for (const v of SPEEDS) {
    const b = el('button', '', `×${v}`)
    b.type = 'button'
    b.setAttribute('aria-pressed', String(v === speed))
    b.addEventListener('click', () => {
      speed = v
      for (const o of sp.children) o.setAttribute('aria-pressed', String(o === b))
    })
    sp.append(b)
  }
  const scrub = $('scrub')
  scrub.max = String(TOTAL)
  scrub.addEventListener('input', () => seek(Number(scrub.value)))
  $('play').addEventListener('click', () => setPlaying(!playing))
  $('restart').addEventListener('click', () => {
    seek(0)
    setPlaying(true)
  })
  $('proj').textContent = `${data.meta.project.id} · ${data.meta.project.name} · 真实运行 ${mins(TOTAL)}${data.meta.simulatedFrom ? '（TR3 之后为模拟）' : ''}，已压缩回放`
  const facts = $('facts')
  const st = data.stats
  const signed = data.events.filter((e) => e.k === 'gate-decision' && e.decision === 'APPROVED')
  const byHuman = signed.filter((e) => e.kind === 'human').length
  for (const [label, value] of [
    ['总用时', mins(TOTAL)],
    ['对话轮次', `${st.turns} 轮`],
    ['工具调用', `${st.toolCalls} 次`],
    ['评审门', `${st.gates} 个，批准 ${signed.length}（人签 ${byHuman}，自动 ${signed.length - byHuman}）`],
    ['角色', `${st.roles} 种，派出 ${st.roleRuns} 次`],
    ['交付物', `${st.deliverables} 份`],
    ['缺陷', st.defects === st.defectsClosed ? `${st.defects} 个，全部关闭` : `${st.defects} 个，已关闭 ${st.defectsClosed}`],
    ['授权请求', `${st.permissions} 次`],
  ]) {
    facts.append(el('span', '', label), el('b', '', value))
  }
  feed.append(el('div', 'empty', '点「播放」开始回放：小川从一句话需求新建项目，一路带到发布。'))
  renderPanels()
  root.host.__assistantDemo = { seek, play: () => setPlaying(true), pause: () => setPlaying(false), state: () => ({ T, idx, playing, turn: state.turn, tools: state.tools, stages: state.stages }) }
  return () => {
    clearInterval(timer)
    window.removeEventListener('pointerup', release)
  }
}
