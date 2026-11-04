// Verify-skill journey: the 「小川演示」 replay page on the real workbench. No model is called (the page replays an exported
// snapshot); the fixture account only lets the first run and the adoption go through.
// Checks: sidebar order 小川 → 小川演示 → 值守中心 → 值守中心 演示, the page renders, plays, can be scrubbed and paused,
// the stage strip reaches 已通过 for all six stages; light and dark screenshots.
// Run: see test/e2e/README.md
import { addFixtureAccount, firstRun, installAndAdopt, startFixture } from './lib.mjs'

export default async function assistantDemoJourney(c) {
  const { page, expect, state, step, shot, note } = c
  const fixture = await startFixture('ok')
  try {
    const t = { timeout: 60_000 }
    const base = state.url.replace(/\/$/, '')
    step('first run, fixture account, install + adopt the current DevBoard')
    await firstRun(c)
    await addFixtureAccount(c, { baseUrl: fixture.baseUrl, apiKey: fixture.apiKey })
    await installAndAdopt(c)

    const link = (re) => page.getByRole('link', { name: re }).or(page.getByRole('button', { name: re })).first()
    step('a. sidebar order')
    await page.goto(`${base}/?new=1`)
    await expect(link(/Xiaochuan|小川/)).toBeVisible(t)
    const names = [/^小川$|^Xiaochuan$/, /小川演示|Xiaochuan demo/, /^值守中心$|^Watch center$/, /值守中心 演示|Watch center demo/]
    const ys = []
    for (const re of names) ys.push((await link(re).boundingBox()).y)
    if (!ys.every((v, i) => i === 0 || ys[i - 1] < v)) throw new Error(`sidebar order wrong: ${ys.join(' < ')}`)
    note(`a: sidebar y ${ys.join(' < ')}`)
    await shot('a-sidebar')

    step('b. open the demo; play, pause, scrub')
    await link(/小川演示|Xiaochuan demo/).click()
    const host = page.locator('.devboard-demo')
    await expect(host.getByRole('heading', { name: '小川演示' })).toBeVisible(t)
    await expect(host.getByText('点「播放」开始回放')).toBeVisible(t)
    await shot('b-initial')
    const hook = () => page.locator('.devboard-demo').evaluate((el) => el.__assistantDemo.state())
    await host.getByRole('button', { name: '×600' }).click()
    await host.getByRole('button', { name: '播放', exact: true }).click()
    await expect.poll(async () => (await hook()).tools, { timeout: 30_000 }).toBeGreaterThan(5)
    await host.getByRole('button', { name: '暂停', exact: true }).click()
    const paused = await hook()
    await page.waitForTimeout(1200)
    expect((await hook()).T).toBe(paused.T) // pausing stops the clock
    note(`b: paused at T=${paused.T}, tools ${paused.tools}, turn ${paused.turn}`)
    await shot('b-playing-light')

    step('c. scrub to the end: six stages passed, gates signed, defects closed')
    await host.getByRole('slider', { name: '时间轴' }).evaluate((el) => {
      el.value = el.max
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const end = await hook()
    expect(Object.values(end.stages).map((s) => s.state)).toEqual(Array(6).fill('PASSED'))
    expect(end.turn).toBeGreaterThan(13)
    await expect(host.getByText('已批准').first()).toBeVisible(t)
    await shot('c-end-light')
    await host.getByRole('slider', { name: '时间轴' }).evaluate((el) => {
      el.value = '600'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((await hook()).turn).toBeLessThan(end.turn) // scrubbing back rebuilds the conversation

    step('d. dark')
    await page.addInitScript(() => localStorage.setItem('agnes-theme', 'dark'))
    await page.goto(`${base}/?new=1`)
    await link(/小川演示|Xiaochuan demo/).click()
    await expect(page.locator('.devboard-demo').getByRole('heading', { name: '小川演示' })).toBeVisible(t)
    await page.locator('.devboard-demo').evaluate((el) => el.__assistantDemo.seek(3000))
    await shot('d-dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await fixture.close()
  }
}
