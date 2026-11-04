// Steps h of the assistant journey: a turn the core's automatic checks end `blocked`, and what wakes an idle coordinator.
// `fx` is the loopback fixture serving the coordinator session and `childFx` the one serving its role children (the
// same fixture unless the model was switched); `proxies` are the delay proxies in front of them. The rest is the journey's page handles.
export async function blockedSteps(c, { fx, childFx = fx, proxies, composer, send, projectId, expectWake }) {
  const { page, expect, step, shot, note } = c
  const t = { timeout: 90_000 }
  const busy = page.getByText('小川正在处理…')
  const card = page.locator('.devboard-assistant-blocked')
  const userLine = (text) => page.locator('.devboard-assistant-bubble.user').filter({ hasText: text })
  const stuck = async (text) => {
    // four identical board writes in a row trip the repeat check (loop-hygiene repeat_threshold 3); the second round of checks parks the turn
    for (let i = 0; i < 4; i++) fx.queueTool({ name: 'devboard_create_requirement', args: { title: 'T9-BLOCK', projectId } })
    const had = await card.count()
    await composer.fill(text)
    await send.click()
    await expect(card).toHaveCount(had + 1, t)
    await expect(busy).toBeHidden(t)
    return card.last()
  }

  step('h1. a turn ended blocked by the automatic checks: the chat explains why, 继续 starts a new turn')
  const first = await stuck('把这个需求登记几次')
  await expect(first).toContainText('这一轮被自动检查拦下了')
  await expect(first).toContainText('重复了同一个操作')
  await expect(first.getByRole('button', { name: '继续', exact: true })).toBeVisible()
  await shot('h1-blocked-light')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await shot('h1-blocked-dark')
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  const before1 = fx.requests.length
  await first.getByRole('button', { name: '继续', exact: true }).click()
  await expect(userLine('继续')).toHaveCount(1, t)
  await expect.poll(() => fx.requests.length, t).toBeGreaterThan(before1)
  await expect(busy).toBeHidden(t)
  await expect(first.getByRole('button', { name: '继续', exact: true })).toHaveCount(0)
  await expect(card).toHaveCount(1)
  await shot('h1-continued')

  step('h2. a message typed after a blocked turn starts a new turn')
  await stuck('再登记几次')
  const before2 = fx.requests.length
  await composer.fill('接着做吧')
  await send.click()
  await expect(userLine('接着做吧')).toHaveCount(1, t)
  await expect
    .poll(() => fx.requests.slice(before2).some((r) => JSON.stringify(r.messages).includes('接着做吧')), t)
    .toBe(true)
  await expect(busy).toBeHidden(t)
  await expect(card).toHaveCount(2)
  await shot('h2-typed-after-blocked')

  step('h3. a role finishing while the coordinator is idle')
  // the role child's first model request is held 15 s, so the coordinator's turn ends first (wait: false) and the notice arrives while it is idle
  for (const p of proxies) p.delayChild = 15_000
  fx.queueTool({ name: 'subagent_spawn', args: { role: '@agnes-showcase/devboard#architect', task: '回复收到即可', isolation: 'shared', wait: false } })
  await composer.fill('派一个角色去办，不用等它')
  await send.click()
  await expect(userLine('派一个角色去办，不用等它')).toHaveCount(1, t)
  await expect(busy).toBeHidden(t)
  const before3 = fx.requests.length
  const childBefore = childFx.requests.length
  const coordinatorSaw = () => fx.requests.slice(before3).some((r) => r.tools.includes('subagent_spawn') && JSON.stringify(r.messages).includes('Handled by'))
  const woke = await expect.poll(coordinatorSaw, { timeout: 60_000 }).toBe(true).then(() => true, () => false)
  for (const p of proxies) p.delayChild = 0
  const childAsked = childFx.requests.slice(childBefore).filter((r) => !r.tools.includes('subagent_spawn')).length
  note(`h3: role child requests after the coordinator went idle: ${childAsked}; coordinator ran the completion notice by itself or after the page's wake: ${woke}`)
  await expect(busy).toBeHidden(t)
  await shot('h3-after-role-done')
  if (!childAsked) throw new Error('the role child never asked its model after the coordinator went idle: the notice did not arrive at an idle coordinator')
  if (expectWake && !woke) throw new Error('an idle coordinator was not woken by the role completion notice')
  return { woke }
}
