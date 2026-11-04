// Verify-skill journey: the DevBoard watch center (值守中心) end to end on the real workbench.
// The model is the loopback provider fixture; its scripted answers are the watch tools (decide / ticket / reply), so every
// ticket below is made by the real coordinator session through the real tools. The actions under test are clicks and typing:
// the sidebar entry, the identity picker, the group chat, the signal desk, the funnel and drawer, a person's action on a ticket.
// Message ids are deterministic in a fresh run (MSG-n / TH-n are counted per project group); a wrong guess fails loudly.
// Run: see test/e2e/README.md
import { addFixtureAccount, firstRun, hotReload, installAndAdopt, startFixture, startFlakyProxy } from './lib.mjs'

const REPLY = '值守已处理。'
const PROJECT = 'PRJ-2025-042'

export default async function watchJourney(c) {
  const { page, expect, state, step, shot, note, cli } = c
  const fixture = await startFixture(REPLY)
  const flaky = await startFlakyProxy(fixture) // the account points at the proxy; it can answer HTTP 400 for the last step
  try {
    const t = { timeout: 60_000 }
    const slow = { timeout: 120_000 }
    const base = state.url.replace(/\/$/, '')

    step('first run, fixture account, install + adopt the current DevBoard')
    await firstRun(c)
    await addFixtureAccount(c, { baseUrl: flaky.baseUrl, apiKey: fixture.apiKey })
    await installAndAdopt(c)

    const link = (re) => page.getByRole('link', { name: re }).or(page.getByRole('button', { name: re })).first()
    const openWatch = async (query = '') => {
      await page.goto(`${base}/?new=1${query}`)
      await link(/Watch center|值守中心/).click()
      await expect(page.getByRole('heading', { name: '值守中心' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('combobox', { name: '我是谁' })).toBeVisible(t)
    }
    const pick = async (label, text) => {
      await page.getByRole('combobox', { name: label, exact: true }).click()
      const option = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option', { hasText: text }).first()
      await option.click()
    }
    const num = async (key) => Number(await page.getByTestId(`funnel-${key}`).locator('strong').innerText())
    const kpi = async (i) => Number(await page.getByTestId('watch-kpi').locator('b').nth(i).innerText())
    const feed = page.getByTestId('watch-page').getByRole('list', { name: '项目群消息' })
    const msg = (text) => feed.getByTestId('watch-msg').filter({ hasText: text }).last()
    const send = async (text) => {
      await page.getByRole('textbox', { name: '在项目群发消息' }).fill(text)
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(msg(text)).toBeVisible(t)
    }
    const needs = page.getByTestId('watch-need')
    const lanes = page.getByTestId('watch-lanes')
    const coord = page.getByTestId('watch-coordinator')
    const idle = () => expect(coord).toHaveAttribute('data-state', 'idle', slow)
    const reqsWith = (text) => fixture.requests.filter((r) => JSON.stringify(r.messages).includes(text))
    const toolTexts = () => fixture.requests.flatMap((r) => r.messages).filter((m) => m.role === 'tool').map((m) => String(m.content))
    const coordinatorIds = async () =>
      JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.filter((s) => s.title.startsWith('值守协调员')).map((s) => s.sessionId).sort()
    const ticketArgs = (ticketId, extra) => ({ projectId: PROJECT, ticketId, ...extra })
    const reply = async (ticketTitle, text) => {
      await lanes.getByRole('button', { name: new RegExp(ticketTitle) }).click()
      await page.getByRole('dialog').getByRole('button', { name: '在此线程回复' }).click()
      await expect(page.getByText(/^回复线程 TH-\d+/)).toBeVisible(t)
      await send(text)
    }

    // ── a. the sidebar entry sits right below 小川 ─────────────────────────────────────────────
    step('a. the entry is below Xiaochuan and above Portfolio')
    await page.goto(`${base}/?new=1`)
    await expect(link(/Xiaochuan|小川/)).toBeVisible(t)
    const y = async (re) => (await link(re).boundingBox()).y
    const [yx, yw, yo] = [await y(/Xiaochuan|小川/), await y(/Watch center|值守中心/), await y(/Portfolio|总览/)]
    if (!(yx < yw && yw < yo)) throw new Error(`sidebar order wrong: Xiaochuan ${yx}, Watch center ${yw}, Portfolio ${yo}`)
    note(`a: sidebar y Xiaochuan ${yx} < Watch center ${yw} < Portfolio ${yo}`)
    await shot('a-sidebar')
    await openWatch()
    await expect(page.locator('.ant-select', { has: page.getByRole('combobox', { name: '项目群' }) })).toContainText(PROJECT)
    await expect(page.getByText('群里还没有消息。')).toBeVisible(t) // no seeded sample activity
    await expect(coord).toHaveAttribute('data-state', 'none')
    await shot('a-opened-empty')

    // ── b. identity ──────────────────────────────────────────────────────────────────────────
    step('b. pick 王海涛 (项目经理); no ticket waits for him yet (board items of his role still show)')
    await pick('我是谁', '王海涛')
    await expect(page.getByTestId('watch-need-count')).toBeAttached(t)
    await expect(needs).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('devboard.watch.me.')))).toBe(true)
    expect(await kpi(0)).toBe(0)
    await shot('b-pm-empty')

    // ── c. chatter is stopped by the rules and never reaches a model ───────────────────────────
    step('c. 「午饭吃什么」 is filtered by the rule layer; no coordinator session is created')
    await send('午饭吃什么')
    await expect(msg('午饭吃什么')).toContainText('已过滤：闲聊')
    await expect.poll(() => num('ruleFiltered'), t).toBe(1)
    await page.waitForTimeout(1500)
    await expect(coord).toHaveAttribute('data-state', 'none')
    expect(fixture.requests.filter((r) => r.tools.some((n) => n.startsWith('devboard_watch_'))).length).toBe(0)
    await shot('c-filtered')

    // ── d. @coordinator: decide accept + start; the ticket shows in the lanes ─────────────────────
    step('d. @研发协调员: the coordinator session is created, accepts the request and starts a child')
    fixture.queueTool({
      name: 'devboard_watch_decide',
      args: { projectId: PROJECT, messageId: 'MSG-2', verdict: 'accept', reason: '对象明确，需要机械设计师分析并起草变更', title: '分析夹紧力复测失败并起草变更', role: '机械设计师', objectRef: 'TT-2026-011', scope: '只读试验记录与图纸；可起草变更草案，不可提交变更' },
    })
    fixture.queueTool({ name: 'devboard_watch_ticket', args: ticketArgs('WI-1', { event: 'start', line: '机械设计师已启动，读取试验记录' }) })
    await send('@研发协调员 夹紧力复测没过，帮我分析失败原因，并起草一份变更')
    await expect(msg('夹紧力复测没过')).toContainText('待协调员判断')
    await expect(lanes.getByRole('button', { name: /分析夹紧力复测失败并起草变更/ })).toBeVisible(slow)
    await idle()
    await expect(msg('夹紧力复测没过')).toContainText('工单：分析夹紧力复测失败并起草变更', t)
    // the brief the model got: source, speaker, thread, rule and the group's context
    const brief = reqsWith('消息：MSG-2 ·').at(-1)
    const briefText = JSON.stringify(brief.messages)
    for (const part of ['【值守·待判断】', 'R-mention', 'TH-2', '午饭吃什么', 'devboard_watch_decide']) if (!briefText.includes(part)) throw new Error(`the brief lacks ${part}: ${briefText.slice(-900)}`)
    expect(toolTexts().join('\n')).toContain('"ticketId":"WI-1"')
    await expect(page.getByTestId('watch-perm')).toHaveCount(0) // watch tools raise no permission card
    await expect(page.getByRole('region', { name: '工具授权' })).toHaveCount(0)
    const sessions1 = await coordinatorIds()
    if (sessions1.length !== 1) throw new Error(`expected one coordinator session, got ${sessions1}`)
    note(`d: coordinator session ${sessions1[0]}, queued tools consumed, brief ok`)
    await shot('d-ticket-in-lanes')

    // ── e. a thread follow-up goes to the coordinator, which logs progress ───────────────────────
    step('e. a reply in the ticket thread is routed to the ticket and forwarded; the coordinator logs progress')
    fixture.queueTool({ name: 'devboard_watch_ticket', args: ticketArgs('WI-1', { line: '定位原因：夹紧弹簧预紧偏低，偏差超出公差' }) })
    await reply('分析夹紧力复测失败并起草变更', '补充：复测记录在 TT-2026-011，请重点看弹簧预紧')
    await expect(msg('补充：复测记录')).toContainText('已送达工单 WI-1', t)
    await expect(lanes).toContainText('定位原因：夹紧弹簧预紧偏低', slow)
    await idle()
    if (reqsWith('【值守·线程补充】').length < 1) throw new Error('the follow-up was not forwarded to the coordinator')
    await shot('e-progress')

    // ── f. needsHuman: the question waits for the technical lead ──────────────────────────────────
    step("f. the coordinator asks the technical lead; it is not in the project manager's list")
    const interrupted = await kpi(0)
    fixture.queueTool({
      name: 'devboard_watch_ticket',
      args: ticketArgs('WI-1', { event: 'ask', line: '草案就绪，等待技术负责人决定', needsHuman: { waitsFor: { role: '技术负责人' }, question: '变更草案已就绪，是否提交评审？' } }),
    })
    await reply('分析夹紧力复测失败并起草变更', '请尽快给出结论')
    await expect.poll(() => kpi(0), slow).toBe(interrupted + 1)
    await idle()
    await expect(needs.filter({ hasText: '提交评审' })).toHaveCount(0)
    await expect(lanes.getByText('没有运行中的子 Agent。')).toBeVisible(t)
    await shot('f-pm-view')

    // ── g. the identity changes what needs me; approval goes back to the coordinator ───────────────
    step('g. as 郑凯 (技术负责人) the question shows; approving reaches the coordinator, which answers in the group')
    await pick('我是谁', '郑凯')
    await expect(needs.filter({ hasText: '提交评审' })).toHaveCount(1, t)
    await shot('g-lead-needs')
    const delivered = await kpi(1)
    const humanBefore = reqsWith('【值守·人已处理】').length
    fixture.queueTool({ name: 'devboard_watch_reply', args: { projectId: PROJECT, threadId: 'TH-2', text: '变更草案已获批准，请按流程提交评审。' } })
    await needs.filter({ hasText: '提交评审' }).getByRole('button', { name: '批准' }).click()
    await expect(needs.filter({ hasText: '提交评审' })).toHaveCount(0, t)
    await expect.poll(() => kpi(1), t).toBe(delivered + 1)
    await expect.poll(() => reqsWith('【值守·人已处理】').length, slow).toBeGreaterThan(humanBefore)
    const actBrief = JSON.stringify(reqsWith('【值守·人已处理】').at(-1).messages)
    for (const part of ['WI-1', '郑凯', '批准']) if (!actBrief.includes(part)) throw new Error(`the human-action message lacks ${part}`)
    await expect(msg('变更草案已获批准')).toContainText('研发协调员', slow)
    await idle()
    await shot('g-approved-and-replied')

    step('g. as 韩雪 (质量工程师) nothing waits')
    await pick('我是谁', '韩雪')
    await expect(page.getByTestId('watch-need-count')).toBeAttached(t)
    await expect(needs).toHaveCount(0)
    await pick('我是谁', '郑凯')

    // ── h. a second ticket closed by the coordinator: finish, +1 delivered ────────────────────────
    step('h. a second request is accepted, started, finished and announced by the coordinator in one turn')
    const before2 = await kpi(1)
    fixture.queueTool({
      name: 'devboard_watch_decide',
      args: { projectId: PROJECT, messageId: 'MSG-6', verdict: 'accept', reason: '只读整理，对象清楚', title: '整理 DEF-0137 关联试验记录', role: '验证工程师', objectRef: 'DEF-0137', scope: '只读试验记录，生成对照表' },
    })
    fixture.queueTool({ name: 'devboard_watch_ticket', args: ticketArgs('WI-2', { event: 'start' }) })
    fixture.queueTool({ name: 'devboard_watch_ticket', args: ticketArgs('WI-2', { event: 'finish', line: '对照表已整理：关联试验 3 条，见 DEF-0137 记录' }) })
    fixture.queueTool({ name: 'devboard_watch_reply', args: { projectId: PROJECT, threadId: 'TH-3', text: 'DEF-0137 的关联试验对照表已整理完成。' } })
    await send('@研发协调员 整理 DEF-0137 关联试验记录')
    await expect.poll(() => kpi(1), slow).toBe(before2 + 1)
    await expect(msg('关联试验对照表已整理完成')).toContainText('研发协调员', slow)
    await idle()
    await shot('h-second-delivered')

    // ── i. a tool permission request of the coordinator is a need of the managers ──────────────────
    step("i. the coordinator's shell call shows in 需要你处理 for managers only; 允许一次 runs it, 拒绝 refuses the next")
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-run" } })
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-denied" } })
    fixture.queueTool({ name: 'devboard_watch_decide', args: { projectId: PROJECT, messageId: 'MSG-8', verdict: 'ignore', reason: '只是探测命令权限' } })
    await send('@研发协调员 试一下命令权限')
    const perm = page.getByTestId('watch-perm')
    await expect(perm).toHaveCount(1, slow)
    await expect(perm).toContainText("printf 'T9%s' OK-run")
    await expect(perm).toContainText('shell')
    await shot('i-permission')
    await pick('我是谁', '韩雪')
    await expect(perm).toHaveCount(0, t) // not a manager: the request is not theirs to answer
    await pick('我是谁', '王海涛')
    await expect(perm).toHaveCount(1, t)
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect.poll(() => toolTexts().join('\n'), slow).toContain('T9OK-run')
    await expect(perm).toContainText('OK-denied', slow)
    await perm.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(perm).toHaveCount(0, t)
    await idle()
    if (toolTexts().join('\n').includes('T9OK-denied')) throw new Error('the refused command ran')
    await expect(msg('试一下命令权限')).toContainText('无需处理', t)

    // ── j. a reload re-attaches the same coordinator session ───────────────────────────────────────
    step('j. reload: the same coordinator session is re-attached and used')
    await page.reload()
    await openWatch()
    await pick('我是谁', '王海涛')
    await expect(coord).toHaveAttribute('data-state', /idle|busy/, slow)
    fixture.queueTool({ name: 'devboard_watch_decide', args: { projectId: PROJECT, messageId: 'MSG-9', verdict: 'record', reason: '重连后的探测' } })
    await send('@研发协调员 重连后你还在吗')
    await expect(msg('重连后你还在吗')).toContainText('协调员判断：仅记录', slow)
    const sessions2 = await coordinatorIds()
    if (sessions2.length !== 1 || sessions2[0] !== sessions1[0]) throw new Error(`reload changed the coordinator session: ${sessions1} -> ${sessions2}`)
    note(`j: same session ${sessions2[0]} after reload`)
    await idle()

    // ── k. light / dark / narrow with real activity ──────────────────────────────────────────────────
    step('k. screenshots: light, dark and narrow')
    await pick('我是谁', '郑凯')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await shot('k-light')
    const wide = { width: 1440, height: 1000 }
    const narrow = { width: 760, height: 1000 }
    await page.addInitScript(() => localStorage.setItem('agnes-theme', 'dark'))
    await openWatch()
    await pick('我是谁', '郑凯')
    await page.keyboard.press('Escape') // close the picker if it stayed open on the already-chosen member
    await page.waitForTimeout(400)
    await shot('k-dark')
    await page.setViewportSize(narrow)
    await shot('k-narrow-dark')
    await page.setViewportSize(wide)
    await page.addInitScript(() => localStorage.setItem('agnes-theme', 'light'))
    await openWatch()
    await page.setViewportSize(narrow)
    await expect(page.getByTestId('watch-page')).toBeVisible(t)
    await shot('k-narrow-light')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize(wide)

    // ── l. rules and members: only managers change them ────────────────────────────────────────────
    step('l. rule modes: a manager switches R-clause to live, others cannot')
    await pick('我是谁', '王海涛')
    await page.getByRole('button', { name: '规则与成员', exact: true }).click()
    const sw = page.getByRole('switch', { name: /客户条款来函起草响应/ })
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true', t)
    await page.keyboard.press('Escape')
    await pick('我是谁', '韩雪')
    await page.getByRole('button', { name: '规则与成员', exact: true }).click()
    await expect(page.getByRole('switch', { name: /客户条款来函起草响应/ })).toBeDisabled()
    await page.keyboard.press('Escape')
    await pick('我是谁', '王海涛')

    // ── m. hot reload: CAPABILITY_DENIED on a coordinator tool result, recreate the session ────────
    step('m. hot reload: the coordinator loses the store, the page shows the notice, 重建协调员会话 recovers')
    await hotReload(c)
    await page.reload()
    await openWatch()
    await pick('我是谁', '王海涛')
    await expect(page.getByTestId('watch-denied')).toHaveCount(0)
    fixture.queueTool({ name: 'devboard_watch_decide', args: { projectId: PROJECT, messageId: 'MSG-10', verdict: 'record', reason: '热重载后的探测' } })
    await send('@研发协调员 热重载之后还能记录吗')
    await expect(page.getByTestId('watch-denied')).toBeVisible(slow)
    await expect(page.getByTestId('watch-denied')).toContainText('重建协调员会话')
    if (!toolTexts().some((x) => x.startsWith('CAPABILITY_DENIED'))) throw new Error(`no CAPABILITY_DENIED tool result: ${toolTexts().slice(-2).join('|').slice(0, 300)}`)
    await expect(coord).toHaveAttribute('data-state', 'denied')
    await expect(msg('热重载之后还能记录吗')).toContainText('待协调员判断')
    await shot('m-denied-notice')
    await page.getByTestId('watch-denied').getByRole('button', { name: '重建协调员会话' }).click()
    await expect(page.getByTestId('watch-denied')).toHaveCount(0, slow)
    const sessions3 = await coordinatorIds()
    if (sessions3.length !== 2 || !sessions3.includes(sessions1[0])) throw new Error(`expected the old session kept and one new: ${sessions1} -> ${sessions3}`)
    // the new session is the registered one: the stuck message is re-sent from the drawer and answered
    fixture.queueTool({ name: 'devboard_watch_decide', args: { projectId: PROJECT, messageId: 'MSG-10', verdict: 'record', reason: '重建后补判' } })
    await msg('热重载之后还能记录吗').getByRole('button').click()
    await page.getByRole('dialog').getByRole('button', { name: '重新送交协调员' }).click()
    await page.keyboard.press('Escape')
    await expect(msg('热重载之后还能记录吗')).toContainText('协调员判断：仅记录', slow)
    await idle()
    await shot('m-recovered')
    await page.reload()
    await openWatch()
    await pick('我是谁', '王海涛')
    await expect(coord).toHaveAttribute('data-state', 'idle', slow)
    if ((await coordinatorIds()).length !== 2) throw new Error('the reload created another coordinator session')
    note('m: recreated session registered; reload re-attached it without a new one')

    // ── n. signal desk and funnel drawer on the recreated session ──────────────────────────────────────
    step('n. a CI failure from the signal desk reaches the coordinator; the funnel number opens the provenance chain')
    await page.getByRole('button', { name: '信号台', exact: true }).click()
    await expect(page.getByRole('button', { name: /播放「宁川的一天」/ })).toBeEnabled(t) // the script player (step o)
    await page.getByTestId('watch-desk').getByRole('button', { name: 'CI 失败', exact: true }).click()
    await page.getByRole('button', { name: '注入信号', exact: true }).click()
    await expect.poll(() => reqsWith('R-ci-red').length, slow).toBeGreaterThan(0)
    await expect(msg('构建失败')).toBeVisible(t)
    await page.getByTestId('watch-desk').getByRole('button', { name: 'CI 通过', exact: true }).click()
    await page.getByRole('button', { name: '注入信号', exact: true }).click()
    await expect.poll(() => num('ruleFiltered'), t).toBe(2)
    await idle()
    await page.getByTestId('funnel-sentToModel').click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByTestId('watch-drawer-list')).toContainText('构建失败')
    await drawer.getByRole('button', { name: /整理 DEF-0137|夹紧力复测没过/ }).first().click()
    await expect(drawer).toContainText('协调员（模型）')
    await shot('n-drawer-provenance')
    await page.keyboard.press('Escape')

    // ── o. 「宁川的一天」: count, confirm, play at 16x, pause, identity switch, reset ─────────────────────
    step('o. the script: the 送判 count is shown and needs a confirm; nothing is posted before it')
    const progress = page.getByTestId('watch-script-progress')
    const done = async () => Number((await progress.innerText()).match(/已注入 (\d+)/)[1])
    const playBtn = page.getByRole('button', { name: /播放「宁川的一天」/ })
    const confirm = page.getByTestId('watch-script-confirm')
    const before = { received: await num('received'), filtered: await num('ruleFiltered'), model: await num('sentToModel') }
    const requestsBefore = fixture.requests.length
    await playBtn.click()
    await expect(confirm).toBeVisible(t)
    const handoff = Number(await confirm.getByTestId('watch-script-handoff').innerText())
    const filtered = Number((await confirm.innerText()).match(/规则层挡掉 (\d+) 条/)[1])
    if (!(handoff >= 8 && filtered > handoff)) throw new Error(`implausible plan: handoff ${handoff}, filtered ${filtered}`)
    await expect(confirm.getByRole('button', { name: new RegExp(`${handoff} 次模型调用`) })).toBeVisible(t)
    await shot('o-script-confirm')
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(await num('received')).toBe(before.received) // no confirm, no posts
    note(`o: plan handoff ${handoff}, filtered ${filtered}`)

    step('o. play at 16x, pause: no new events; the identity switch keeps the position; resume to the end')
    await playBtn.click()
    await page.getByTestId('watch-script-confirm').getByRole('button', { name: /确认，开始播放/ }).click()
    await page.getByRole('group', { name: '倍速' }).getByRole('button', { name: '16x', exact: true }).click()
    await expect(page.getByTestId('watch-script-status')).toContainText('16x', t)
    await expect.poll(done, { timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(3)
    await page.getByTestId('watch-script').getByRole('button', { name: '暂停', exact: true }).click()
    await page.waitForTimeout(1200)
    const paused = await done()
    await page.waitForTimeout(2500)
    expect(await done()).toBe(paused)
    if (!(paused >= 3 && paused < 63)) throw new Error(`pause came at ${paused} of 63`)
    await pick('我是谁', '郑凯')
    await expect(page.getByTestId('watch-script-status')).toHaveAttribute('data-state', 'paused', t)
    expect(await done()).toBe(paused)
    await shot('o-script-paused')
    await page.getByTestId('watch-script').getByRole('button', { name: '继续', exact: true }).click()
    await expect(progress).toContainText('剧本播完了', { timeout: 180_000 })
    expect(await done()).toBe(63)

    step('o. filtered events show as 已过滤, the counts equal the plan, coordinator-bound events reached the model')
    await expect(msg('door-ctrl-fw #480 构建通过')).toContainText('已过滤：构建通过', t)
    await expect(msg('周刊')).toContainText('已过滤：订阅邮件', t)
    expect((await num('ruleFiltered')) - before.filtered).toBe(filtered)
    expect((await num('sentToModel')) - before.model).toBe(handoff)
    expect((await num('received')) - before.received).toBe(63)
    await expect.poll(() => reqsWith('nightly-regression 2 个用例失败').length, slow).toBeGreaterThan(0)
    if (fixture.requests.length <= requestsBefore) throw new Error('no script event reached the model')
    if (!JSON.stringify(reqsWith('nightly-regression 2 个用例失败').at(-1).messages).includes('【值守·待判断】')) throw new Error('the script event arrived without the watch brief')
    await idle()
    note(`o: ${fixture.requests.length - requestsBefore} model requests during the script, filtered +${filtered}, to model +${handoff}`)
    await expect(page.getByTestId('watch-script-status')).toHaveCount(0)
    await shot('o-script-done')

    step('o. chain from a funnel number: 规则挡掉 → a script message → its provenance')
    await page.getByTestId('funnel-ruleFiltered').click()
    await page.getByRole('dialog').getByRole('button', { name: /构建通过/ }).first().click()
    await expect(page.getByRole('dialog')).toContainText('规则层', t)
    await shot('o-script-chain')
    await page.keyboard.press('Escape')

    step('o. light, dark and narrow with 63 more messages')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await shot('o-light')
    await page.addInitScript(() => localStorage.setItem('agnes-theme', 'dark'))
    await openWatch()
    await pick('我是谁', '郑凯')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await shot('o-dark')
    await page.getByRole('button', { name: '信号台', exact: true }).click()
    await shot('o-dark-desk')
    await page.setViewportSize(narrow)
    await shot('o-narrow-dark')
    await page.setViewportSize(wide)
    await page.addInitScript(() => localStorage.setItem('agnes-theme', 'light'))
    await openWatch()
    await page.getByRole('button', { name: '信号台', exact: true }).click()
    await page.setViewportSize(narrow)
    await shot('o-narrow-light')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize(wide)

    step('o. reset: a non-manager cannot, the technical lead empties the group and keeps members and rules')
    await pick('我是谁', '韩雪')
    await expect(page.getByRole('button', { name: '重置值守记录', exact: true })).toBeDisabled(t)
    await pick('我是谁', '郑凯')
    await page.getByRole('button', { name: '重置值守记录', exact: true }).click()
    await page.getByRole('button', { name: '确认重置', exact: true }).click()
    await expect(page.getByText('群里还没有消息。')).toBeVisible(t)
    for (const k of ['received', 'ruleFiltered', 'sentToModel', 'accepted', 'delivered']) await expect.poll(() => num(k), t).toBe(0)
    await expect(page.getByTestId('watch-script')).toHaveAttribute('data-phase', 'idle')
    await expect(playBtn).toHaveText('播放「宁川的一天」')
    await shot('o-after-reset')
    await page.getByRole('button', { name: '规则与成员', exact: true }).click()
    await expect(page.getByRole('switch', { name: /客户条款来函起草响应/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('watch-settings')).toContainText('王海涛')
    await page.keyboard.press('Escape')

    // ── p. a failed coordinator turn is shown, not left as 处理中 ────────────────────────────────────
    step('p. the provider answers HTTP 400: the coordinator chip says 上一轮失败 with the reason; the next message recovers')
    flaky.failing = true
    await send('@研发协调员 这条会被模型服务拒绝')
    await expect(coord).toHaveAttribute('data-state', 'failed', slow)
    await expect(coord).toContainText('上一轮失败')
    await expect(page.getByTestId('watch-coord-error')).toContainText('TRANSPORT: status=400')
    await shot('p-coordinator-failed')
    flaky.failing = false
    await send('@研发协调员 恢复了吗')
    await expect(coord).not.toHaveAttribute('data-state', 'failed', slow)
    await idle()
  } finally {
    await flaky.close()
    await fixture.close()
  }
}
