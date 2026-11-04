// Verify-skill journey: the DevBoard assistant page (小川) end to end on the real workbench.
// The model is the loopback provider fixture; its scripted answers are tool calls, so every board change
// below goes through the real DevBoard tools. The actions under test are user clicks and typing.
// Run: see test/e2e/README.md
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockedSteps } from './blocked-steps.mjs'
import { addFixtureAccount, firstRun, hotReload, installAndAdopt, startFixture, startFlakyProxy, startSecondFixture } from './lib.mjs'

// A Markdown reply, as real models write; the bubbles are matched by its last, plain paragraph.
const REPLY_SEEN = '小川已办理，请看值守栏。'
const REPLY = `**已处理。** 进展如下：\n\n- 产出已写入看板，见下方卡片\n- 需要你决定的事在右侧 \`值守栏\`\n\n${REPLY_SEEN}`
const NAME = '社区图书借阅登记台'
const COMMAND = "printf 'T9%s' OK-run"

export default async function assistantJourney(c) {
  const { page, expect, state, step, shot, note, cli } = c
  const fixture = await startFixture(REPLY)
  const secondFixture = await startSecondFixture(REPLY)
  const flaky = await startFlakyProxy(secondFixture) // `second` is the same fixture behind a proxy that can answer HTTP 400
  const second = Object.assign(secondFixture, { baseUrl: flaky.baseUrl })
  const firstDelay = await startFlakyProxy(fixture) // role children run on the first account's model; this one only delays them
  fixture.baseUrl = firstDelay.baseUrl
  try {
    const t = { timeout: 60_000 }
    const toolTexts = () =>
      fixture.requests.flatMap((r) => r.messages).filter((m) => m.role === 'tool').map((m) => String(m.content))
    const sentHandbacks = () => fixture.requests.filter((r) => JSON.stringify(r.messages).includes('自动交回 · '))

    step('first run, fixture account, install + adopt the current DevBoard')
    await firstRun(c)
    await addFixtureAccount(c, fixture)
    await addFixtureAccount(c, second, 'Second fixture account') // a second model to switch to
    await installAndAdopt(c)

    // The chat replays from the ledger after a reload, a few lines at a time: the reply count is only meaningful once the
    // last user line is back and the count has stopped growing.
    const settledReplies = async (lastUserLine) => {
      await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: lastUserLine })).toHaveCount(1, t)
      let last = -1
      await expect
        .poll(async () => {
          const n = await bubbles.count()
          const same = n === last
          last = n
          await page.waitForTimeout(1500)
          return same && n > 0
        }, t)
        .toBe(true)
      return last
    }

    // ── a. the page opens and the session is created ───────────────────────────────────────────
    step('a. open the assistant page')
    await page.goto(`${state.url.replace(/\/$/, '')}/?new=1`)
    // DevBoard's own sidebar entry only. The host's Chats list also has a row named 小川 (the session), and right after a
    // reload that row renders before the plugin entry does, so a name match alone clicked the host conversation view.
    const nav = page.locator('.home-entry').filter({ hasText: /^\s*(Xiaochuan|小川)\s*$/ })
    await expect(nav.first()).toBeVisible({ timeout: 30_000 })
    await shot('a-before-open')
    const heading = page.getByRole('heading', { name: '小川 · 研发助理' })
    // A reload lands on the host's new-conversation view (see the note below), so the user reopens the page from the sidebar.
    const openPage = async () => {
      await nav.first().click()
      await expect(heading).toBeVisible({ timeout: 60_000 })
    }
    await openPage()
    note(`a: url on the page ${page.url()}`)
    const composer = page.getByRole('textbox', { name: '对小川说' })
    const send = page.getByRole('button', { name: '发送', exact: true })
    await expect(page.getByText('和小川说点什么，例如')).toBeVisible(t)
    await shot('a-opened')
    // the read-only label: board actions need no card, commands and file edits still ask; a plain note, never a control
    const label = page.getByLabel(/^看板操作免确认：/)
    await expect(label).toBeVisible(t)
    await expect(label).toHaveText('看板操作免确认')
    await expect(label).toHaveAttribute('title', '小川登记看板无需逐条确认；运行命令、改文件仍会问你')
    await expect(label).toHaveAttribute('role', 'note')
    expect(await label.evaluate((el) => el.tagName)).toBe('SPAN')
    await expect(page.getByRole('button', { name: /看板操作免确认/ })).toHaveCount(0)
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('a-label-dark')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await shot('a-label-light')
    // the session is created and renamed: the host sidebar lists it as 小川, and the CLI agrees
    await expect(page.getByText('小川', { exact: true }).first()).toBeVisible(t)
    await expect
      .poll(async () => JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.some((s) => s.title === '小川'), { timeout: 30_000 })
      .toBe(true)
    await composer.fill('你好')
    await expect(send).toBeEnabled()
    // focused, the card draws the only ring: the textarea itself has no border or halo of its own
    await composer.click()
    await expect(composer).toBeFocused()
    expect(await composer.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none')
    expect(await composer.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
    await shot('a-composer-focused')
    await composer.fill('')
    note('a: session created and titled 小川; composer accepts input')

    const bubbles = page.locator('.devboard-assistant-bubble:not(.user)', { hasText: REPLY_SEEN })
    let replies = 0
    const ask = async (text, label) => {
      await shot(`${label}-before`)
      await composer.fill(text)
      await send.click()
      await expect(bubbles).toHaveCount(++replies, { timeout: 90_000 })
      await expect(page.getByText('小川正在处理…')).toBeHidden(t)
      await shot(`${label}-after`)
    }

    // ── b. a request turns into scripted tool calls and a reply ───────────────────────────────
    step('b. create a project through the coordinator')
    fixture.queueTool({ name: 'devboard_project_create', args: { name: NAME, description: '小型无依赖 Node 网页应用：登记借书、还书。' } })
    await ask(`新建项目：${NAME}`, 'b-project')
    const progress = page.locator('details.devboard-assistant-progress')
    await expect(progress.filter({ hasText: '新建项目' })).toHaveCount(1)
    await expect(progress.first()).not.toHaveAttribute('open', '') // collapsed
    await expect(page.getByRole('region', { name: '工具授权' })).toHaveCount(0) // a board write asks nothing
    const projectId = toolTexts().join('\n').match(/PRJ-\d{4}-\d{3}/)?.[0]
    if (!projectId) throw new Error(`no project id in the tool results: ${toolTexts().join('|').slice(0, 400)}`)
    note(`b: project ${projectId}`)
    await expect(page.getByRole('region', { name: `项目 ${NAME}` })).toBeVisible()
    await expect(page.getByRole('group', { name: '当前项目' }).getByRole('button', { name: NAME })).toBeVisible()

    step('b. submit the concept gate, pre-flight it')
    const gateId = `GATE-${projectId}-CDCP-1`
    fixture.queueTool({ name: 'devboard_gate_submit', args: { projectId, stage: 'INITIATION' } })
    fixture.queueTool({ name: 'devboard_gate_check', args: { gateId } })
    await ask('提交立项评审并做一次快检', 'b-gate')
    await expect(progress.filter({ hasText: '提交评审门' })).toHaveCount(1)
    await expect(progress.filter({ hasText: '规则快检' })).toHaveCount(1)
    const gateCard = page.getByRole('region', { name: '评审门' })
    await expect(gateCard).toContainText('CDCP')
    const rail = page.getByRole('complementary', { name: '值守栏' })
    const section = (title) => rail.locator('section.devboard-assistant-sec', { has: page.getByRole('heading', { name: new RegExp(title) }) })
    const cdcp = new RegExp(`CDCP.*${projectId}`)
    await expect(section('需要你处理').getByRole('button', { name: cdcp })).toBeVisible() // the person-decided gate waits in 需要你处理
    await shot('b-rail-gate')

    // ── c. human in the loop ───────────────────────────────────────────────────────────────────
    step('c1. an intervention is asked and answered inline, the answer is handed back')
    fixture.queueTool({ name: 'devboard_create_requirement', args: { title: '登记借书', projectId } })
    await ask('录入需求：登记借书', 'c1-requirement')
    const reqId = toolTexts().join('\n').match(/REQ-\d+/)?.[0]
    if (!reqId) throw new Error('no requirement id in the tool results')
    fixture.queueTool({
      name: 'devboard_request_human',
      args: { type: 'REQUIREMENT_APPROVAL', entityKind: 'requirement', entityId: reqId, ask: '请确认登记借书的验收标准', dueInHours: 24 },
    })
    await ask('这个需求请我拍板', 'c1-ask')
    const ask1 = page.getByRole('region', { name: '需要你拍板' })
    await expect(ask1).toContainText('请确认登记借书的验收标准')
    await expect(rail.getByRole('button', { name: /请确认登记借书的验收标准/ })).toBeVisible()
    const handbacksBefore = sentHandbacks().length
    await shot('c1-before-answer')
    await ask1.getByRole('button', { name: '认领', exact: true }).click()
    await ask1.getByRole('textbox', { name: '处理结论' }).fill('验收标准已确认')
    await ask1.getByRole('button', { name: '处理完成', exact: true }).click()
    await shot('c1-after-answer')
    // automatic hand-back: a chat line and a new fixture request that carries the hand-back prompt
    await expect(page.getByText(/^自动交回 · /).first()).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(handbacksBefore)
    replies++ // the coordinator answered the hand-back with the fixture reply
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    note(`c1: hand-back prompt reached the model: ${JSON.stringify(sentHandbacks().at(-1).messages.at(-1)).slice(0, 300)}`)
    if (!JSON.stringify(sentHandbacks().at(-1).messages).includes('已答复 → 交回研发协调员继续')) throw new Error('the hand-back request lacks the intervention hand-back text')
    await shot('c1-handed-back')
    step('c2. approve the person-decided gate in its chat card')
    const afterAnswer = sentHandbacks().length
    const gate = page.getByRole('region', { name: '评审门' }).last()
    await shot('c2-before-approve')
    await gate.getByRole('button', { name: '以「IPMT」批准' }).click()
    await expect(section('已完成').getByRole('button', { name: cdcp })).toBeVisible(t)
    await expect(section('需要你处理').getByRole('button', { name: cdcp })).toHaveCount(0)
    await shot('c2-after-approve')
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(afterAnswer)
    await expect(page.getByText(/^自动交回 · CDCP/).first()).toBeVisible(t)
    replies++
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    if (!JSON.stringify(sentHandbacks().at(-1).messages).includes('CDCP 已批准 → 交回研发协调员继续')) throw new Error('the hand-back request lacks the gate hand-back text')
    await shot('c2-handed-back')

    // ── c2b. a technical gate (no customer rep) is decided in the chat too, as the role the server says waits ──
    step('c2b. TR1 pops its panel under the reply and is signed as the technical lead, no page or role switch')
    const chatUrl = page.url()
    const roleSwitch = page.getByRole('combobox', { name: '演示角色' })
    await expect(roleSwitch).toHaveCount(0) // the demo-role switch lives on other pages; nothing here needs it
    const afterTr1Setup = sentHandbacks().length
    fixture.queueTool({ name: 'devboard_stage_update', args: { projectId, stage: 'REQUIREMENTS', note: '开始需求阶段' } })
    fixture.queueTool({
      name: 'devboard_artifact_record',
      args: { projectId, stage: 'REQUIREMENTS', kind: 'SRS', path: 'docs/SRS.md', content: '# 软件需求\n\n登记借书、还书。', actingRole: 'requirements' },
    })
    fixture.queueTool({ name: 'devboard_gate_submit', args: { projectId, stage: 'REQUIREMENTS' } })
    await ask('提交需求评审', 'c2b-tr1')
    // no review meeting has run: the coordinator is told to convene one, and the panel offers no signing yet
    if (!toolTexts().join('\n').includes('下一步：本轮召开评审会')) throw new Error('the TR1 submit result lacks the review-meeting next step')
    const tr1Wait = page.getByRole('region', { name: '评审门' }).last()
    await expect(tr1Wait).toContainText('等待评审会', t)
    await expect(tr1Wait.getByRole('button', { name: /批准|驳回/ })).toHaveCount(0)
    await expect(section('需要你处理').getByRole('button', { name: new RegExp(`TR1.*${projectId}`) })).toHaveCount(0)
    // the panel sits below the reply that submits the gate (checked before the later hand-over turn adds a reply)
    const below = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.devboard-assistant-bubble:not(.user), section.devboard-assistant-card[aria-label="评审门"]')]
      return nodes.at(-1)?.matches('section.devboard-assistant-card') && nodes.at(-2)?.matches('.devboard-assistant-bubble')
    })
    if (!below) throw new Error('the TR1 panel is not below the reply')
    // the meeting escalates to a person (stood in for by the hand-over request): the signing panel appears
    fixture.queueTool({ name: 'devboard_request_human', args: { type: 'REQUIREMENT_APPROVAL', entityKind: 'gate', entityId: `GATE-${projectId}-TR1-1`, ask: '评审会连续驳回，请裁决 TR1' } })
    await ask('评审会转人工', 'c2b-tr1-handed')
    const tr1Text = toolTexts().join('\n')
    if (!tr1Text.includes('下方面板以「技术负责人」批准')) throw new Error(`humanNext does not point at the panel: ${tr1Text.slice(-500)}`)
    if (/演示角色|我的待办|到看板/.test(tr1Text.slice(tr1Text.indexOf('下方面板') - 200))) throw new Error('humanNext still sends the user to the board')
    const tr1Card = page.getByRole('region', { name: '评审门' }).last()
    await expect(tr1Card).toContainText('TR1')
    const approveTr1 = tr1Card.getByRole('button', { name: '以「技术负责人」批准' })
    await expect(approveTr1).toBeVisible(t)
    await expect(section('需要你处理').getByRole('button', { name: new RegExp(`TR1.*${projectId}`) })).toBeVisible(t)
    // regression: the host's global `input { width: 100% }` once stretched the checkbox, pushing the code and text away from it
    const rowGap = await tr1Card.locator('.devboard-assistant-findings label').first().evaluate((label) => {
      const box = label.querySelector('input').getBoundingClientRect()
      const code = label.querySelector('.devboard-assistant-code').getBoundingClientRect()
      return { gap: code.left - box.right, sameRow: code.top < box.bottom && code.bottom > box.top }
    })
    if (!rowGap.sameRow || rowGap.gap < 0 || rowGap.gap >= 24) throw new Error(`the finding checkbox is not next to its code: ${JSON.stringify(rowGap)}`)
    await shot('c2b-tr1-panel')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('c2b-tr1-panel-dark')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    // the system finding on the gate (coverage) is closed by the approver at the decision, as on the board
    await tr1Card.getByRole('checkbox').check()
    await tr1Card.getByRole('textbox', { name: '关闭说明' }).fill('需求覆盖由人确认')
    await approveTr1.click()
    await expect(section('已完成').getByRole('button', { name: new RegExp(`TR1.*${projectId}`) })).toBeVisible(t)
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(afterTr1Setup)
    await expect(page.getByText(/^自动交回 · TR1/).first()).toBeVisible(t)
    replies++
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    if (page.url() !== chatUrl) throw new Error(`the page changed during the decision: ${chatUrl} -> ${page.url()}`)
    await shot('c2b-handed-back')

    // ── c2d. the auto gate TR4 passes by itself: no person decides, the page still hands it back ──
    step('c2d. TR4 (auto) passes when its findings are closed; the page sends the next coordinator turn by itself')
    const afterTr3Setup = sentHandbacks().length
    fixture.queueTool({ name: 'devboard_stage_update', args: { projectId, stage: 'DESIGN', note: '开始设计阶段' } })
    fixture.queueTool({ name: 'devboard_gate_submit', args: { projectId, stage: 'DESIGN' } })
    await ask('提交设计评审', 'c2d-tr3')
    fixture.queueTool({ name: 'devboard_request_human', args: { type: 'REQUIREMENT_APPROVAL', entityKind: 'gate', entityId: `GATE-${projectId}-TR3-1`, ask: '评审会连续驳回，请裁决 TR3' } })
    await ask('评审会转人工', 'c2d-tr3-handed')
    const tr3Card = page.getByRole('region', { name: '评审门' }).last()
    await expect(tr3Card).toContainText('TR3')
    for (const box of await tr3Card.getByRole('checkbox').all()) await box.check() // system findings are closed by the approver
    if (await tr3Card.getByRole('textbox', { name: '关闭说明' }).count()) await tr3Card.getByRole('textbox', { name: '关闭说明' }).first().fill('由人确认')
    // the TR3 hand-back turn starts the implementation stage and submits TR4 with one open finding
    fixture.queueTool({ name: 'devboard_stage_update', args: { projectId, stage: 'IMPLEMENTATION', note: '开始实现阶段' } })
    fixture.queueTool({ name: 'devboard_gate_submit', args: { projectId, stage: 'IMPLEMENTATION', findings: ['缺少端口参数校验'] } })
    await tr3Card.getByRole('button', { name: '以「技术负责人」批准' }).click()
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(afterTr3Setup)
    replies++
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    // TR4 stays pending with an open finding: its "blocking findings" card starts one more turn by itself
    await expect.poll(() => JSON.stringify(sentHandbacks().at(-1)?.messages ?? ''), { timeout: 60_000 }).toContain('TR4 有 1 条阻断意见未关闭 → 交回研发协调员安排修复')
    replies++
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    const afterTr4Submit = sentHandbacks().length
    // the coordinator closes the finding in a turn the person started; TR4 passes by itself and the coordinator then stops
    fixture.queueTool({
      name: 'devboard_gate_submit',
      args: { projectId, stage: 'IMPLEMENTATION', closeFindings: [{ id: 'F-01', note: '已补充端口参数校验' }] },
    })
    // the typed turn and the auto-pass hand-back turn can land back to back, so count both replies at once
    await shot('c2d-close-before')
    await composer.fill('关闭 TR4 的评审意见')
    await send.click()
    // nobody types anything now: the hand-back card of the auto pass is sent as the next turn
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(afterTr4Submit)
    await expect(page.getByText(/^自动交回 · TR4 已自动通过/).first()).toBeVisible(t)
    replies += 2
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    if (!JSON.stringify(sentHandbacks().at(-1).messages).includes('TR4 已自动通过 → 交回研发协调员进入下一阶段')) throw new Error('the hand-back request lacks the auto-gate hand-back text')
    await shot('c2d-handed-back')

    // ── c2c. an approval flow (ECR, five roles then CCB) is decided in the chat, one role at a time ──
    step('c2c. an ECR approval flow: sign role by role in the chat panel, then the CCB node')
    const afterTr1 = sentHandbacks().length
    fixture.queueTool({ name: 'devboard_fastforward', args: { gate: 'TR3_CHANGE' } })
    await ask('演示：TR3 待批并有一条客户变更', 'c2c-change')
    const flowCard = page.getByRole('region', { name: '审批流程' }).last()
    await expect(flowCard).toContainText('专业会签')
    const roles = ['机械设计师', '电气设计师', '软件设计师', '工艺工程师', '质量工程师']
    for (const [i, role] of roles.entries()) {
      const agree = flowCard.getByRole('button', { name: `以「${role}」同意` })
      await expect(agree).toBeVisible(t)
      if (i === 0) {
        await shot('c2c-ecr-panel')
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await shot('c2c-ecr-panel-dark')
        await page.evaluate(() => document.documentElement.classList.remove('dark'))
        await page.setViewportSize({ width: 420, height: 900 })
        await flowCard.scrollIntoViewIfNeeded()
        await shot('c2c-ecr-panel-narrow')
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      await expect(flowCard.getByRole('button', { name: /^以「.+」同意$/ })).toHaveCount(1) // an all-roles node offers one role at a time
      await agree.click()
      await expect(agree).toHaveCount(0, t)
    }
    // the CCB node: either role may decide, the panel offers each
    const ccb = flowCard.getByRole('button', { name: '以「技术负责人」同意' })
    await expect(ccb).toBeVisible(t)
    await expect(flowCard.getByRole('button', { name: /^以「.+」同意$/ })).toHaveCount(2)
    await shot('c2c-ccb-panel')
    await ccb.click()
    await expect.poll(() => sentHandbacks().length, { timeout: 60_000 }).toBeGreaterThan(afterTr1)
    replies++
    await expect(bubbles).toHaveCount(replies, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    if (page.url() !== chatUrl) throw new Error(`the page changed during the approval: ${chatUrl} -> ${page.url()}`)
    await shot('c2c-handed-back')

    step('c3. second view: reload, reattach the same session, nothing is handed back twice')
    const afterBoth = sentHandbacks().length
    const sessionsBefore = JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.filter((s) => s.title === '小川').length
    await page.reload()
    note(`reload lands on ${page.url()}; assistant heading visible without a click: ${await heading.isVisible()}`)
    await openPage()
    await expect(section('已完成').getByRole('button', { name: cdcp })).toBeVisible(t) // the gate decision is in the store
    await expect(section('需要你处理').getByRole('button', { name: cdcp })).toHaveCount(0)
    await expect(rail.getByRole('button', { name: /请确认登记借书的验收标准/ })).toHaveCount(0) // the answered request too
    await page.waitForTimeout(3000)
    if (sentHandbacks().length !== afterBoth) throw new Error('a hand-back was sent again after a reload')
    const sessionsAfter = JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.filter((s) => s.title === '小川').length
    if (sessionsAfter !== sessionsBefore) throw new Error(`reload created another assistant session (${sessionsBefore} -> ${sessionsAfter})`)
    // the earlier conversation comes back from the ledger, each line once
    for (const line of [`新建项目：${NAME}`, '提交立项评审并做一次快检', '录入需求：登记借书', '这个需求请我拍板']) {
      await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: line })).toHaveCount(1, t)
    }
    await expect(bubbles).toHaveCount(replies, t)
    note(`c3: chat history replayed after reload: ${await page.locator('.devboard-assistant-item').count()} lines, ${replies} replies`)
    await shot('c3-reloaded')

    step('c4. switch to another DevBoard page and back: same chat, no new session, no second hand-back')
    const switchTo = async (pattern) => {
      await page.locator('.home-entry').filter({ hasText: pattern }).first().click()
    }
    await switchTo(/^\s*(总览|Portfolio)\s*$/)
    await expect(heading).toBeHidden(t)
    await shot('c4-other-page')
    await switchTo(/^\s*(Xiaochuan|小川)\s*$/)
    await expect(heading).toBeVisible(t)
    for (const line of [`新建项目：${NAME}`, '提交立项评审并做一次快检', '录入需求：登记借书', '这个需求请我拍板']) {
      await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: line })).toHaveCount(1, t)
    }
    await expect(bubbles).toHaveCount(replies, t)
    if (sentHandbacks().length !== afterBoth) throw new Error('a hand-back was sent again after a page switch')
    await expect(bubbles.last()).toBeInViewport() // the replayed chat opens at its latest line
    const sessionsSwitched = JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.filter((s) => s.title === '小川').length
    if (sessionsSwitched !== sessionsBefore) throw new Error(`a page switch created another assistant session (${sessionsBefore} -> ${sessionsSwitched})`)
    await shot('c4-back')

    // ── d. a tool permission prompt ────────────────────────────────────────────────────────────
    step('d. a shell call asks for permission, the card shows the whole command, 允许一次 runs it')
    const before = toolTexts().length
    fixture.queueTool({ name: 'shell', args: { command: COMMAND } })
    await composer.fill('跑一条命令看看')
    await shot('d-before')
    await send.click()
    const perm = page.getByRole('region', { name: '工具授权' })
    await expect(perm).toBeVisible({ timeout: 90_000 })
    await expect(perm).toContainText(COMMAND)
    await shot('d-card')
    // leave the page while the request is pending: the card is still there on return (the request is not cancelled)
    await switchTo(/^\s*(总览|Portfolio)\s*$/)
    await expect(heading).toBeHidden(t)
    await switchTo(/^\s*(Xiaochuan|小川)\s*$/)
    await expect(perm).toBeVisible(t)
    await expect(perm).toContainText(COMMAND)
    await shot('d-card-after-page-switch')
    // reload while the request is pending: it must come back as a card, not be auto-rejected at attach
    await page.reload()
    await openPage()
    await expect(perm).toBeVisible(t)
    await expect(perm).toContainText(COMMAND)
    await shot('d-card-after-reload')
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(perm).toBeHidden(t)
    await expect.poll(() => toolTexts().slice(before).join('\n'), { timeout: 60_000 }).toContain('T9OK-run')
    await shot('d-after')

    // ── d2. a board write in a turn that already holds untrusted output asks nothing; the shell still asks ──
    step('d2. shell output taints the turn: the next board write shows no card, a second shell command still does')
    const REQ2 = '登记还书'
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-two" } })
    fixture.queueTool({ name: 'devboard_create_requirement', args: { title: REQ2, projectId } })
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-three" } })
    await composer.fill('先跑命令，再登记需求，再跑一条命令')
    await send.click()
    await expect(perm).toBeVisible({ timeout: 90_000 })
    await expect(perm).toContainText('OK-two')
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    // the board write follows the tainted shell result and must not raise a card; the next card is the second command's
    await expect(perm).toContainText('OK-three', { timeout: 90_000 })
    if (!toolTexts().some((x) => x.includes(REQ2))) throw new Error('the board write did not run')
    await expect(perm).not.toContainText('devboard')
    await shot('d2-second-shell-card')
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(perm).toBeHidden(t)
    await expect.poll(() => toolTexts().join('\n'), { timeout: 60_000 }).toContain('T9OK-three')
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await shot('d2-after')

    // ── d2b. a request nobody answers past its delivery deadline (60 s): the turn parks, the card stays answerable ──
    step('d2b. unanswered shell request: after the deadline the tool line says 等待你授权, the card is still there, 允许一次 runs it')
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-parked" } })
    await composer.fill('再跑一条命令，我先不批')
    await send.click()
    await expect(perm).toBeVisible({ timeout: 90_000 })
    await expect(perm).toContainText('OK-parked')
    // only a decision parked on the durable record shows this hint: the live request is gone by then
    await expect(page.getByText('等待你授权', { exact: true })).toBeVisible({ timeout: 150_000 })
    await expect(perm).toBeVisible(t)
    await expect(perm).toContainText('OK-parked')
    await expect(page.locator('.devboard-assistant-rcard', { hasText: '待授权的工具' })).toBeVisible(t)
    await shot('d2b-parked-card')
    await page.reload() // the parked card comes back from the durable record
    await openPage()
    await expect(perm).toContainText('OK-parked', t)
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(perm).toBeHidden(t)
    await expect.poll(() => toolTexts().join('\n'), { timeout: 60_000 }).toContain('T9OK-parked')
    await expect(page.getByText('等待你授权', { exact: true })).toBeHidden(t)
    await expect(page.getByText('小川正在处理…')).toBeHidden({ timeout: 90_000 }) // the turn resumed by itself and finished
    await shot('d2b-after')

    // ── d3. a document written through the board tool in a tainted turn asks nothing and lands in the workspace ──
    step('d3. board read taints the turn: devboard_artifact_record with content writes docs/PROJECT-PLAN.md without a card')
    const PLAN = '# 项目计划\n\n目标：登记借书、还书。\n\n范围与里程碑见下。T9-PLAN'
    // A chat session's files live in the run's chats directory (the tool's ctx.fs root, the same one the host write tool uses), not in the picked workspace.
    const planFile = join(state.home, 'data', 'chats', 'devboard-projects', projectId, 'docs', 'PROJECT-PLAN.md')
    fixture.queueTool({ name: 'devboard_board', args: {} })
    fixture.queueTool({
      name: 'devboard_artifact_record',
      args: { projectId, stage: 'INITIATION', kind: 'PLAN', path: 'docs/PROJECT-PLAN.md', content: PLAN },
    })
    await composer.fill('读一下看板，再把项目计划写进去')
    await send.click()
    // the board read's result also lists DOC- ids, so wait for the file itself
    await expect.poll(() => readFile(planFile, 'utf8').catch(() => ''), { timeout: 90_000 }).toBe(PLAN)
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await expect(perm).toHaveCount(0) // neither the board read nor the document write raised a card
    await expect(page.getByRole('region', { name: '交付物' }).getByText(/项目计划/).first()).toBeVisible(t)
    await shot('d3-after')
    note(`d3: ${planFile} written through devboard_artifact_record, no permission card`)

    // ── d4. a role child writes its document through the board tool: no card in a tainted child turn; host write still asks ──
    step('d4. architect children write docs/SAD.md with devboard_doc_write after a spawn result tainted the turn: no card; a child host write still asks')
    const ARCH = '@agnes-showcase/devboard#architect'
    const sadFile = join(state.home, 'data', 'chats', 'devboard-projects', projectId, 'docs', 'SAD.md')
    const spawn = (task) => ({ name: 'subagent_spawn', args: { role: ARCH, task, isolation: 'shared', wait: true } })
    const SKELETON = '# SAD\n\n## 模块\n<!--S1-->\n\n## 接口\n<!--S2-->\n'
    fixture.queueTool({ name: 'devboard_board', args: {} })
    fixture.queueTool(spawn(`在项目 ${projectId} 写 docs/SAD.md 骨架`))
    fixture.queueTool({ name: 'devboard_doc_write', args: { projectId, path: 'docs/SAD.md', content: SKELETON } })
    // the second spawn follows the first spawn's result in the same turn: its child is tainted (parentTainted)
    fixture.queueTool(spawn(`在项目 ${projectId} 的 docs/SAD.md 补第一、二节`))
    fixture.queueTool({
      name: 'devboard_doc_write',
      args: { projectId, path: 'docs/SAD.md', edits: [{ oldText: '<!--S1-->', newText: '模块甲、模块乙。T9-S1' }, { oldText: '<!--S2-->', newText: 'GET /health。T9-S2' }] },
    })
    // control: the same tainted child through the host write tool still asks
    fixture.queueTool(spawn('在项目目录写一个笔记文件 T9-CTRL.txt'))
    fixture.queueTool({ name: 'write', args: { path: 'T9-CTRL.txt', content: 'T9-CTRL' } })
    await composer.fill('读一下看板，再派架构师写 SAD（分两个子会话），再派一个写笔记')
    await send.click()
    await expect
      .poll(() => readFile(sadFile, 'utf8').catch(() => ''), { timeout: 180_000 })
      .toBe(SKELETON.replace('<!--S1-->', '模块甲、模块乙。T9-S1').replace('<!--S2-->', 'GET /health。T9-S2'))
    // both document writes are done and no card has been raised so far; the third child's host write is the first card
    await expect(perm).toBeVisible({ timeout: 120_000 })
    await expect(perm).toContainText('T9-CTRL')
    await expect(perm).not.toContainText('devboard_doc_write')
    await shot('d4-host-write-card')
    await perm.getByRole('button', { name: '允许一次', exact: true }).click()
    await expect(perm).toBeHidden(t)
    await expect(page.getByText('小川正在处理…')).toBeHidden({ timeout: 120_000 })
    // wiring evidence: a role child's model request carried exactly one devboard tool, devboard_doc_write
    const childReqs = fixture.requests.filter((r) => r.tools.includes('devboard_doc_write') && !r.tools.includes('subagent_spawn'))
    if (childReqs.length < 2) throw new Error(`no role child request carried devboard_doc_write (${childReqs.length})`)
    for (const r of childReqs) if (r.tools.filter((x) => x.startsWith('devboard_')).join() !== 'devboard_doc_write') throw new Error(`a role child holds ${r.tools.filter((x) => x.startsWith('devboard_'))}`)
    note(`d4: ${sadFile} written by role children through devboard_doc_write (${childReqs.length} child requests carried only that board tool), no card; the host write card appeared once`)
    await shot('d4-after')

    // ── d5. rework continues the original role child: its parentTainted was fixed at spawn, so a tainted turn adds no card ──
    step('d5. a second spawn after a spawn result asks (control); subagent_send_message to the first developer child lets its host edit run without a card')
    const DEV = '@agnes-showcase/devboard#developer'
    const appFile = join(state.home, 'data', 'chats', 'devboard-projects', projectId, 'src', 'app.js')
    const cards = []
    const devSpawn = (task) => ({ name: 'subagent_spawn', args: { role: DEV, task, isolation: 'shared', wait: true } })
    const lastToolText = (name) => {
      const msgs = fixture.requests.at(-1).messages
      const idx = msgs.findLastIndex((m) => m.role === 'assistant' && JSON.stringify(m.tool_calls ?? '').includes(name))
      return String(msgs.slice(idx + 1).find((m) => m.role === 'tool')?.content ?? '')
    }
    // subagent_list prints one `<key> <status> continuable` line per child, oldest first: A is the one before B (the last)
    let keyA
    const childKeyOfA = () => {
      const keys = lastToolText('subagent_list').split('\n').filter((l) => l.includes(' idle continuable')).map((l) => l.split(' ')[0])
      if (keys.length < 2) throw new Error(`subagent_list shows ${keys.length} idle continuable children`)
      keyA = keys.at(-2)
      return keyA
    }
    fixture.queueTool(devSpawn(`T10-A 在项目 ${projectId} 写 src/app.js`))
    fixture.queueTool({ name: 'write', args: { path: `devboard-projects/${projectId}/src/app.js`, content: 'const a = 1 // M1\nconst b = 2 // M2\n' } })
    fixture.queueTool(devSpawn('T10-B 改 src/app.js 第一行'))
    fixture.queueTool({ name: 'edit', args: { path: `devboard-projects/${projectId}/src/app.js`, edits: [{ oldText: 'M1', newText: 'B1' }] } })
    fixture.queueTool({ name: 'subagent_list', args: {} })
    fixture.queueTool({ name: 'subagent_send_message', args: { get childKey() { return childKeyOfA() }, text: '把 M2 改成 A2' } })
    // only the child takes this edit; the coordinator's own next request must not consume it
    fixture.queueTool({
      get name() {
        return fixture.requests.at(-1).tools.includes('subagent_spawn') ? 'none' : 'edit'
      },
      args: { path: `devboard-projects/${projectId}/src/app.js`, edits: [{ oldText: 'M2', newText: 'A2' }] },
    })
    await composer.fill('派开发写 app.js，再派第二个开发改，再让第一个开发续改')
    await send.click()
    // approve every card as it shows and record it; the continued child's edit must not be one of them
    const diag = () => `cards=${JSON.stringify(cards.map((c) => c.slice(0, 400)))}; tools=${JSON.stringify(toolTexts().slice(-6).map((x) => x.slice(0, 300)))}; reqs=${fixture.requests.slice(-4).map((r) => r.tools.includes('subagent_spawn') ? 'coord' : 'child').join()}`
    await expect
      .poll(async () => {
        if ((await perm.count()) > 0) {
          cards.push((await perm.first().innerText()).replace(/\s+/g, ' '))
          await shot(`d5-card-${cards.length}`)
          await perm.getByRole('button', { name: '允许一次', exact: true }).first().click()
        }
        return readFile(appFile, 'utf8').catch(() => '')
      }, { timeout: 240_000, intervals: [300] })
      .toContain('A2')
      .catch((e) => { throw new Error(`${e.message} ${diag()}`) })
    for (const c of cards) note(`d5 card: ${c.slice(0, 700)}`)
    const tainted = (c) => c.includes('untrusted tool output')
    if (!cards.some((c) => !c.includes(keyA) && tainted(c))) throw new Error(`control: the second spawn's child raised no taint card. ${diag()}`)
    if (cards.some((c) => c.includes(keyA) && tainted(c))) throw new Error(`the continued child still carries the parent taint. ${diag()}`)
    await expect(page.getByText('小川正在处理…')).toBeHidden({ timeout: 120_000 })
    await expect(perm).toHaveCount(0)
    note(`d5: ${appFile} = ${JSON.stringify(await readFile(appFile, 'utf8'))}; the continued developer child edited with no card`)
    await shot('d5-after')

    // ── d6. a review meeting seats read-only reviewers in a tainted turn: neither the spawn nor their read tools ask ──
    step('d6. reviewer and quality spawned after a spawn result, each reading the project: no permission card')
    const RV = '@agnes-showcase/devboard#reviewer'
    const QA = '@agnes-showcase/devboard#quality'
    const readerSpawn = (role) => ({ name: 'subagent_spawn', args: { role, task: `你只读项目 ${projectId} 的目录并回复 pass`, isolation: 'shared', wait: true } })
    const readerBefore = fixture.requests.length
    fixture.queueTool(devSpawn('T11-A 只回复收到')) // its result taints the turn
    fixture.queueTool(readerSpawn(RV))
    fixture.queueTool({ name: 'ls', args: { path: `devboard-projects/${projectId}` } })
    fixture.queueTool({ name: 'grep', args: { pattern: 'M1', path: `devboard-projects/${projectId}` } })
    fixture.queueTool(readerSpawn(QA))
    fixture.queueTool({ name: 'ls', args: { path: `devboard-projects/${projectId}` } })
    await composer.fill('派开发回复收到，再派评审员和质量工程师读一遍项目')
    await send.click()
    const readerRequests = () => fixture.requests.slice(readerBefore).filter((r) => !r.tools.includes('subagent_spawn') && JSON.stringify(r.messages).includes('你只读项目'))
    await expect.poll(() => readerRequests().length, { timeout: 180_000 }).toBeGreaterThanOrEqual(4) // two children, a tool call and a final answer each
    await expect(page.getByText('小川正在处理…')).toBeHidden({ timeout: 180_000 })
    const readerReqs = readerRequests()
    await expect(perm).toHaveCount(0)
    note(`d6: reviewer and quality children ran in the tainted turn (${readerReqs.length} requests) and read the project; no card`)
    await shot('d6-after')

    // ── e. design review: Markdown rendered, dark theme, a narrow page folds the rail into a drawer ──
    step('e. reply Markdown, dark theme, narrow page with the rail drawer')
    const reply = bubbles.last()
    await expect(reply.locator('strong', { hasText: '已处理。' })).toBeVisible()
    await expect(reply.locator('li')).toHaveCount(2)
    await expect(reply).not.toContainText('**')
    // a long chat scrolls inside the page: the header and the composer stay on screen
    await expect(heading).toBeInViewport()
    await expect(composer).toBeInViewport()
    // the verify browser pins the light theme at every load, so the dark look is taken by the host's root class
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('e-dark-1440')
    await page.setViewportSize({ width: 1024, height: 800 })
    const railButton = page.getByRole('button', { name: /^值守/ })
    await expect(railButton).toBeVisible()
    await expect(rail).toBeHidden()
    await expect(composer).toBeInViewport()
    await shot('e-dark-1024')
    await railButton.click()
    await expect(rail).toBeVisible()
    await shot('e-dark-1024-rail')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await rail.getByRole('button', { name: '收起值守栏' }).click()
    await expect(rail).toBeHidden()
    await shot('e-light-1024')

    // ── f. the header shows the session's model and switches it ────────────────────────────────
    step('f. the model button shows the primary model; switching changes it, and the next request uses it')
    await page.setViewportSize({ width: 1440, height: 1000 })
    const modelBtn = page.getByRole('button', { name: /^模型：/ })
    await expect(modelBtn).toBeVisible(t)
    const beforeName = (await modelBtn.getAttribute('aria-label')).replace('模型：', '')
    await shot('f-model-light')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('f-model-dark')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await modelBtn.click()
    const menu = page.getByRole('menu', { name: '选择模型' })
    await expect(menu).toBeVisible()
    const items = menu.getByRole('menuitemradio')
    note(`f: models offered: ${(await items.allInnerTexts()).join(' | ')}; routes: ${(await Promise.all((await items.all()).map((i) => i.getAttribute('title')))).join(' | ')}`)
    expect(await items.count()).toBeGreaterThan(1)
    await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(1)
    await shot('f-model-menu')
    await page.keyboard.press('Escape') // Escape closes the menu
    await expect(menu).toBeHidden()
    await modelBtn.click()
    await page.mouse.click(700, 500) // so does a click outside
    await expect(menu).toBeHidden()
    await modelBtn.click()
    const other = menu.getByRole('menuitemradio', { checked: false }).first()
    const otherName = (await other.innerText()).trim()
    await other.click()
    await expect(modelBtn).toHaveAttribute('aria-label', `模型：${otherName}`, t)
    if (otherName === beforeName) throw new Error('the switch did not change the model name')
    await shot('f-model-switched')
    // the session's ledger carries it: reopen the page (re-read from the daemon), then a request goes out on the new model
    await page.reload()
    await openPage()
    await expect(page.getByRole('button', { name: /^模型：/ })).toHaveAttribute('aria-label', `模型：${otherName}`, t)
    const [firstBefore, secondBefore] = [fixture.requests.length, second.requests.length]
    const repliesNow = await settledReplies('读一下看板，再把项目计划写进去') // d's, d2's and d3's replies were not counted in `replies`
    await composer.fill('现在用的是哪个模型？')
    await send.click()
    await expect(bubbles).toHaveCount(repliesNow + 1, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await shot('f-model-after-request')
    note(`f: before ${beforeName}, after ${otherName}; requests: first +${fixture.requests.length - firstBefore}, second +${second.requests.length - secondBefore}; models seen ${[...fixture.requests, ...second.requests].map((r) => r.model).join(',')}`)
    // the first account still serves the auxiliary (fast) slot; the conversation itself moved to the second
    if (!second.requests.slice(secondBefore).some((r) => r.model === 'deepseek-v4-pro')) throw new Error('the next request did not go out on the switched model')

    step('f2. the provider answers HTTP 400: the failed turn shows an error line, the composer works again')
    flaky.failing = true
    await composer.fill('这条会被模型服务拒绝')
    await send.click()
    const failed = page.locator('.devboard-assistant-failed')
    await expect(failed).toContainText('这一轮没有完成：模型服务返回错误（status=400）', { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await failed.locator('summary').click()
    await expect(failed).toContainText('TRANSPORT: status=400')
    await expect(composer).toBeEnabled()
    await shot('f2-turn-error')
    flaky.failing = false
    await composer.fill('恢复了吗？')
    await send.click()
    await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: '恢复了吗？' })).toHaveCount(1, t)
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)

    // ── g. a new conversation, and the notice after a plugin hot reload ────────────────────────
    step('g. header: the 新对话 button, light / dark / narrow')
    const newBtn = page.getByRole('button', { name: '新对话', exact: true })
    const assistantIds = async () =>
      JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.filter((s) => s.title === '小川').map((s) => s.sessionId).sort()
    const flowItems = page.locator('.devboard-assistant-item')
    await expect(newBtn).toBeEnabled(t)
    await shot('g-header-light')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('g-header-dark')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.setViewportSize({ width: 800, height: 800 })
    await expect(newBtn).toBeVisible()
    await expect(newBtn).toHaveAccessibleName('新对话')
    await shot('g-header-narrow')
    await page.setViewportSize({ width: 1440, height: 1000 })
    const idsBefore = await assistantIds()
    const handbacksG = sentHandbacks().length
    const modelNow = (await page.getByRole('button', { name: /^模型：/ }).getAttribute('aria-label'))

    step('g. hot reload the installed DevBoard: the open session loses its store, a board call shows the notice')
    await hotReload(c)
    await page.reload() // the person comes back to the updated page; the conversation is the same, opened before the reload
    await openPage()
    replies = await settledReplies('现在用的是哪个模型？')
    // the model was switched in f, so this session's requests go to the second fixture; a new session keeps it
    const textsOf = (fx) => fx.requests.flatMap((r) => r.messages).filter((m) => m.role === 'tool').map((m) => String(m.content))
    const stale = page.locator('.devboard-assistant-stale')
    await expect(stale).toHaveCount(0)
    second.queueTool({ name: 'devboard_board', args: {} })
    await composer.fill('看一眼看板')
    await send.click()
    await expect(stale).toBeVisible({ timeout: 90_000 })
    await expect(stale).toContainText('插件已更新，这个对话无法再读写看板')
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    if (!textsOf(second).some((x) => x.startsWith('CAPABILITY_DENIED'))) throw new Error(`no CAPABILITY_DENIED tool result: ${textsOf(second).slice(-2).join('|').slice(0, 300)}`)
    await expect(progress.filter({ hasText: '查看看板' }).last()).toContainText('失败')
    await shot('g-stale-notice')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await shot('g-stale-notice-dark')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))

    step('g. 开始新对话 in the notice: chat empties, a new session is registered, the old one stays listed')
    await stale.getByRole('button', { name: '开始新对话' }).click()
    await expect(flowItems).toHaveCount(0, t)
    await expect(page.getByText('和小川说点什么，例如')).toBeVisible(t)
    await expect(stale).toHaveCount(0)
    const idsAfter = await assistantIds()
    const added = idsAfter.filter((id) => !idsBefore.includes(id))
    if (added.length !== 1 || !idsBefore.every((id) => idsAfter.includes(id))) throw new Error(`expected one new session and the old ones kept: ${idsBefore} -> ${idsAfter}`)
    const modelAfter = await page.getByRole('button', { name: /^模型：/ }).getAttribute('aria-label')
    note(`g: new session ${added[0]}; model before ${modelNow}, after ${modelAfter}`)
    if (modelAfter !== `模型：${otherName}` || modelNow !== modelAfter) throw new Error(`the new conversation did not keep the model: ${modelNow} -> ${modelAfter}`)
    await expect(page.getByRole('button', { name: /^模型：/ })).toHaveAttribute('aria-label', `模型：${otherName}`, t)
    await shot('g-new-conversation')

    step('g. the new session reads the board; nothing is handed back again')
    const toolsBefore = textsOf(second).length
    const [firstReq, secondReq] = [fixture.requests.length, second.requests.length]
    second.queueTool({ name: 'devboard_board', args: {} })
    await composer.fill('再看一眼看板')
    await send.click()
    await expect(progress.filter({ hasText: '查看看板' })).toHaveCount(1, { timeout: 90_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await expect(progress.filter({ hasText: '查看看板' }).first()).not.toContainText('失败')
    await expect(stale).toHaveCount(0)
    const fresh = textsOf(second).slice(toolsBefore).join('\n')
    // the carried model: the new session's request reached the second fixture on deepseek-v4-pro, not the first
    if (!second.requests.slice(secondReq).some((r) => r.model === 'deepseek-v4-pro')) throw new Error('the new session did not request the carried model')
    if (fixture.requests.slice(firstReq).some((r) => r.messages.some((m) => String(m.content).includes('再看一眼看板')))) throw new Error('the new session talked to the first fixture')
    if (fresh.includes('CAPABILITY_DENIED') || !fresh.includes('PRJ-')) throw new Error(`the new session's board call did not succeed: ${fresh.slice(0, 300)}`)
    await page.waitForTimeout(3000)
    if (second.requests.slice(secondReq).some((r) => JSON.stringify(r.messages).includes('自动交回 · '))) throw new Error('a hand-back reached the new session')
    if (sentHandbacks().length !== handbacksG) throw new Error('a claimed hand-back was sent again after the new conversation')
    await shot('g-new-conversation-board')

    step('g. reload: the NEW session is re-attached, the old chat does not come back')
    await page.reload()
    await openPage()
    await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: '再看一眼看板' })).toHaveCount(1, t)
    await expect(page.locator('.devboard-assistant-bubble.user').filter({ hasText: NAME })).toHaveCount(0)
    if ((await assistantIds()).length !== idsAfter.length) throw new Error('the reload created another session')
    await shot('g-reloaded')

    step('g. the header button starts another conversation without a notice')
    await newBtn.click()
    await expect(flowItems).toHaveCount(0, t)
    await expect.poll(async () => (await assistantIds()).length, { timeout: 30_000 }).toBe(idsAfter.length + 1)
    await shot('g-header-new-conversation')

    // ── h. blocked turns and idle wake, in the newest session (its model is the second fixture) ──
    await blockedSteps(c, { fx: second, childFx: fixture, proxies: [flaky, firstDelay], composer, send, projectId, expectWake: true })
  } finally {
    await fixture.close()
    await second.close()
    await flaky.close()
    await firstDelay.close()
  }
}
