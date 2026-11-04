// Verify-skill journey: reloading 小川 after a long conversation shows the history again, also with a second tab on the session.
// Run: see test/e2e/README.md (node agh-verify.mjs drive reload-history-journey.mjs --run <root>)
import { addFixtureAccount, firstRun, hotReload, installAndAdopt, startFixture, syncWatched } from './lib.mjs'

const REPLY_SEEN = '小川已办理，请看值守栏。'
const ROUNDS = Number(process.env.RELOAD_ROUNDS ?? 6)
const PER_ROUND = Number(process.env.RELOAD_TOOLS ?? 60)
// RELOAD_WATCHED=1: install into the watched <home>/plugins/devboard folder and sync it, as devboard-dev-sync.sh does.
const WATCHED = process.env.RELOAD_WATCHED === '1'

export default async function reloadHistory(c) {
  const { page, expect, state, step, shot, note, cli } = c
  const fixture = await startFixture(`好的。${REPLY_SEEN}`)
  try {
    const t = { timeout: 90_000 }
    step('setup')
    await firstRun(c)
    await addFixtureAccount(c, fixture)
    await installAndAdopt(c, { watched: WATCHED })
    const nav = (p) => p.locator('.home-entry').filter({ hasText: /^\s*(Xiaochuan|小川)\s*$/ })
    const open = async (p) => {
      await p.goto(`${state.url.replace(/\/$/, '')}/?new=1`)
      await nav(p).first().click()
      await expect(p.getByRole('heading', { name: '小川 · 研发助理' })).toBeVisible({ timeout: 60_000 })
    }
    await open(page)
    const composer = page.getByRole('textbox', { name: '对小川说' })
    const send = page.getByRole('button', { name: '发送', exact: true })
    const bubbles = page.locator('.devboard-assistant-bubble:not(.user)', { hasText: REPLY_SEEN })
    const user = (p, text) => p.locator('.devboard-assistant-bubble.user').filter({ hasText: text })

    step('build a long conversation')
    let replies = 0
    for (let r = 1; r <= ROUNDS; r++) {
      for (let i = 0; i < PER_ROUND; i++) fixture.queueTool({ name: 'devboard_board', args: {} })
      await composer.fill(`第 ${r} 轮：登记一批项目`)
      await send.click()
      await expect(bubbles).toHaveCount(++replies, { timeout: 180_000 })
      await expect(page.getByText('小川正在处理…')).toBeHidden(t)
      const list = JSON.parse((await cli(['sessions', 'list', '--json'])).stdout).items.find((s) => s.title === '小川')
      note(`round ${r}: session ${JSON.stringify(list)?.slice(0, 300)}`)
    }
    const lastLine = `第 ${ROUNDS} 轮：登记一批项目`
    await shot('long-before-reload')

    step('reload: the history is back')
    await page.reload()
    await open(page)
    await expect(user(page, lastLine)).toHaveCount(1, t)
    await expect(bubbles.last()).toBeVisible(t)
    note(`reload: ${await page.locator('.devboard-assistant-item').count()} lines`)
    await shot('long-after-reload')

    step('plugin hot reload and re-adopt without a page reload: the open page keeps its history')
    await (WATCHED ? syncWatched(c) : hotReload(c))
    await page.waitForTimeout(5000)
    const heading = page.getByRole('heading', { name: '小川 · 研发助理' })
    if (!(await heading.isVisible())) await nav(page).first().click()
    await expect(heading).toBeVisible({ timeout: 60_000 })
    note(`after hot reload (no reload): ${await page.locator('.devboard-assistant-item').count()} lines`)
    await expect(user(page, lastLine)).toHaveCount(1, t)
    await expect(bubbles.last()).toBeVisible(t)
    await shot('long-after-hot-reload')

    step('then a page reload: the history is back')
    await page.reload()
    await open(page)
    await expect(user(page, lastLine)).toHaveCount(1, t)
    await expect(bubbles.last()).toBeVisible(t)

    step('two tabs: open a second tab, reload the first')
    const other = await page.context().newPage()
    await open(other)
    await expect(user(other, lastLine)).toHaveCount(1, t)
    await page.reload()
    await open(page)
    await expect(user(page, lastLine)).toHaveCount(1, t)
    await shot('two-tabs-after-reload')

    step('two tabs: a permission request reaches the page that was opened last')
    fixture.queueTool({ name: 'shell', args: { command: "printf 'T9%s' OK-run" } })
    await composer.fill('跑一条命令看看')
    await send.click()
    const perm = page.getByRole('region', { name: '工具授权' })
    await expect(perm).toBeVisible({ timeout: 30_000 })
    await shot('two-tabs-card')
    await expect(other.getByText('小川已在另一个标签页打开')).toBeVisible()
    await expect(other.getByRole('region', { name: '工具授权' })).toHaveCount(0)
    await perm.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(perm).toBeHidden(t)

    step('two tabs: 在此页接回 takes the session back, the other tab lets go')
    await other.getByRole('button', { name: '在此页接回', exact: true }).click()
    await expect(page.getByText('小川已在另一个标签页打开')).toBeVisible(t)
    await expect(other.getByText('小川已在另一个标签页打开')).toBeHidden(t)
    await other.close()

    step('F5 on the URL-selected session: the workbench reads it first, the history is still shown')
    // Without ?new=1 the workbench restores the selected session (?session=<id>) and attaches it before the page mounts.
    await page.goto(state.url)
    await nav(page).first().click()
    await expect(page.getByRole('heading', { name: '小川 · 研发助理' })).toBeVisible({ timeout: 60_000 })
    expect(page.url()).toContain('session=')
    await page.reload()
    await expect(page.getByRole('heading', { name: '小川 · 研发助理' })).toBeVisible({ timeout: 60_000 })
    await expect(user(page, lastLine)).toHaveCount(1, t)
    await shot('selected-session-f5')

    step('new conversation, dev sync, F5: the page opens the new conversation with its history')
    await page.getByRole('button', { name: /新对话/ }).click()
    await expect(user(page, lastLine)).toHaveCount(0, t)
    await composer.fill('新对话第一轮')
    await send.click()
    await expect(bubbles.last()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('小川正在处理…')).toBeHidden(t)
    await (WATCHED ? syncWatched(c) : hotReload(c))
    await page.waitForTimeout(3000)
    await page.reload() // the URL still names the first conversation; the stored record names the new one
    await expect(page.getByRole('heading', { name: '小川 · 研发助理' })).toBeVisible({ timeout: 60_000 })
    await expect(user(page, '新对话第一轮')).toHaveCount(1, t)
    await expect(user(page, lastLine)).toHaveCount(0)
    await shot('new-conversation-after-sync-f5')
  } finally {
    await fixture.close()
  }
}
