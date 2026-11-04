// Repro of the real-run stall: a role child finished and was collected, then subagent_send_message to it.
// Run like the assistant journey (see README.md).
import { addFixtureAccount, firstRun, hotReload, installAndAdopt, startFixture, startFlakyProxy } from './lib.mjs'

export default async function continueCollected(c) {
  const { page, expect, state, step, note, cli } = c
  const fixture = await startFixture('小川已办理。')
  const delay = await startFlakyProxy(fixture) // holds the role child's first request so the coordinator turn ends first
  fixture.baseUrl = delay.baseUrl
  try {
    const t = { timeout: 90_000 }
    await firstRun(c)
    await addFixtureAccount(c, fixture)
    await installAndAdopt(c)
    await page.goto(`${state.url.replace(/\/$/, '')}/?new=1`)
    await page.locator('.home-entry').filter({ hasText: /^\s*(Xiaochuan|小川)\s*$/ }).first().click()
    const composer = page.getByRole('textbox', { name: '对小川说' })
    const send = page.getByRole('button', { name: '发送', exact: true })
    const busy = page.getByText('小川正在处理…')
    await expect(composer).toBeVisible(t)
    const toolResults = () => fixture.requests.flatMap((r) => r.messages).filter((m) => m.role === 'tool').map((m) => String(m.content))
    const lastWith = (re) => toolResults().filter((x) => re.test(x)).at(-1) ?? ''

    step('spawn (wait:false), let it finish, collect, then continue')
    delay.delayChild = 8_000
    fixture.queueTool({ name: 'subagent_spawn', args: { role: '@agnes-showcase/devboard#architect', task: '回复收到即可', isolation: 'shared', wait: false } })
    await composer.fill('派一个角色去办，不用等它')
    await send.click()
    await expect(busy).toBeHidden(t)
    const before = fixture.requests.length
    fixture.queueTool({ name: 'subagent_list', args: {} })
    fixture.queueTool({ get name() { return 'subagent_collect' }, args: { get childKey() { return lastWith(/ (idle|running|completed)/).split('\n')[0].split(' ')[0] }, wait: true } })
    fixture.queueTool({ name: 'subagent_send_message', args: { get childKey() { return lastWith(/ (idle|running|completed)/).split('\n')[0].split(' ')[0] }, text: '再补一句' } })
    // the completion notice wakes the idle coordinator by itself
    await expect.poll(() => fixture.requests.slice(before).some((r) => r.tools.includes('subagent_spawn') && JSON.stringify(r.messages).includes('Handled by')), { timeout: 90_000 }).toBe(true)
    await expect.poll(async () => (await busy.count()) === 0 && toolResults().some((x) => x.startsWith('sent ') || /unknown child|not continuable/.test(x)), { timeout: 90_000 }).toBe(true)
    const dump = (label) => {
      const last = fixture.requests.filter((r) => r.tools.includes('subagent_spawn')).at(-1).messages
      const trace = last.flatMap((m) => (m.role === 'assistant' && m.tool_calls ? m.tool_calls.map((x) => `CALL ${x.function.name}`) : m.role === 'tool' ? [`RESULT ${String(m.content).slice(0, 200)}`] : []))
      note(`${label}:\n${trace.slice(-8).join('\n')}`)
    }
    dump('A: collected, then continued at once')

    // B: the same continuation after the plugin was reloaded (the dev sync does this): the session lives on, its child factory is new
    step('reload the plugin, then list and continue the same child again')
    await hotReload(c)
    const coord = () => fixture.requests.filter((r) => r.tools.includes('subagent_spawn')).at(-1).messages
    const keyA = String(coord().find((m) => m.role === 'tool' && /\S+ (idle|running|completed)/.test(String(m.content))).content).split(' ')[0]
    const mark = fixture.requests.length
    fixture.queueTool({ name: 'subagent_list', args: {} })
    fixture.queueTool({ name: 'subagent_send_message', args: { childKey: keyA, text: '再补一句' } })
    await composer.fill('再让它改一下')
    await send.click()
    await expect.poll(async () => (await busy.count()) === 0 && fixture.requests.length > mark + 2, { timeout: 90_000 }).toBe(true)
    dump('B: after plugin reload')
  } finally {
    await delay.close()
    await fixture.close?.()
  }
}
