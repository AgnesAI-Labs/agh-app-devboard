// Helpers of the assistant journey: first run, loopback provider account, install + adopt the CURRENT
// source tree of DevBoard into the isolated run. Setup only; the actions under test are driven in the journey.
import { appendFile, cp, rm } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGNES = process.env.AGNES_REPO ?? join(homedir(), 'agnes-harness')

export async function firstRun({ page, expect, state }) {
  await page.goto(state.url)
  const guide = page.getByTestId('first-run-guide')
  await page.getByTestId('first-run-demo').click()
  await page.getByTestId('first-run-next').click()
  await guide.locator('.agh-disclosure > .agh-disclosure-summary').click()
  await guide.getByRole('textbox', { name: 'Folder path', exact: true }).fill(state.workspace)
  await guide.getByRole('button', { name: 'Use folder', exact: true }).click()
  await page.getByTestId('first-run-next').click()
  await page.getByTestId('first-run-next').click()
  await expect(guide).toBeHidden()
}

/** Loopback OpenAI-compatible fixture; `deepseek-flash` is a model id the installed DeepSeek catalogue has. */
export async function startFixture(reply) {
  const { startProviderFixture } = await import(`${AGNES}/tools/acceptance/provider-fixture.ts`)
  return startProviderFixture(reply, undefined, 'deepseek-flash')
}

/** A second loopback fixture with another model id, so the switch has somewhere to go. */
export async function startSecondFixture(reply) {
  const { startProviderFixture } = await import(`${AGNES}/tools/acceptance/provider-fixture.ts`)
  return startProviderFixture(reply, undefined, 'deepseek-v4-pro')
}

/**
 * A loopback proxy in front of a fixture that answers every chat request with HTTP 400 while `proxy.failing` is true,
 * and holds each request that carries no `subagent_spawn` tool (a role child's or a title request) for `proxy.delayChild` ms.
 */
export async function startFlakyProxy(fixture) {
  const upstream = fixture.baseUrl // read once: the caller points fixture.baseUrl at this proxy afterwards
  const proxy = { failing: false, delayChild: 0, baseUrl: '', apiKey: fixture.apiKey, close: () => {} }
  const server = createServer(async (req, res) => {
    const body = Buffer.concat(await req.toArray())
    if (proxy.delayChild && req.method === 'POST' && !String(body).includes('"subagent_spawn"')) await new Promise((r) => setTimeout(r, proxy.delayChild))
    if (proxy.failing && req.method === 'POST') return void res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"bad request"}}')
    const target = new URL(req.url.replace(/^\/v1\//, ''), upstream + '/')
    const up = httpRequest(target, { method: req.method, headers: { authorization: req.headers.authorization, 'content-type': 'application/json' } }, (r) => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] ?? 'application/json' })
      r.pipe(res)
    })
    up.on('error', () => res.writeHead(502).end())
    up.end(req.method === 'POST' ? body : undefined)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  proxy.baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  proxy.close = () => server.closeAllConnections() || new Promise((r) => server.close(r))
  return proxy
}

/** Settings > Model: add a DeepSeek account that points at the fixture (same clicks as the maintained model-accounts journey). */
export async function addFixtureAccount({ page, expect }, fixture, name = 'Fixture account') {
  if (!(await page.locator('#settings').isVisible())) await page.locator('#sidebar-toggle').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTestId('settings-nav-model').click()
  // The first account starts from the welcome tiles; a later one from the Add account button and the provider tiles.
  const welcome = page.locator('.config-accounts-welcome [data-provider="deepseek"]')
  if (await welcome.isVisible()) await welcome.click()
  else {
    await page.getByRole('button', { name: 'Add account', exact: true }).first().click()
    await page.locator('#config-provider-choices [data-provider="deepseek"]').click()
  }
  const dialog = page.locator('.account-dialog-body[data-page="add"]')
  const advanced = dialog.locator('#config-account-advanced')
  const toggle = advanced.locator(':scope > summary, :scope > .agh-disclosure-summary').first()
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  else if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
  await dialog.getByRole('textbox', { name: 'Account name', exact: true }).fill(name)
  await dialog.getByRole('textbox', { name: 'Base URL', exact: true }).fill(fixture.baseUrl)
  await dialog.locator('#config-api-key').fill(fixture.apiKey)
  await expect(dialog.locator('#config-state')).toContainText('Connected.')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('#config-accounts')).toHaveAttribute('data-state', 'ready')
  await page.keyboard.press('Escape')
}

/** Copy the worktree package (without test/) next to the run and install it with `agh plugins add`, then adopt it on the Agents page. */
export async function installAndAdopt({ page, expect, state, cli, shot }, { watched = false } = {}) {
  const copy = join(dirname(state.home), 'devboard-src')
  await rm(copy, { recursive: true, force: true })
  await cp(SRC, copy, { recursive: true, filter: (p) => !p.startsWith(join(SRC, 'test')) })
  if (watched) {
    // The dev loop's way: the daemon watches <home>/plugins/<name>/ and installs what lands there (no `plugins add`).
    await cp(copy, join(state.home, 'plugins', 'devboard'), { recursive: true })
    await expect.poll(async () => (await cli(['plugins', 'status'])).stdout.split('\n').some((l) => l.includes('devboard@') && l.includes('actual=running')), { timeout: 60_000 }).toBe(true)
  } else await cli(['plugins', 'add', copy, '--yes'])
  await page.goto(`${state.url.replace(/\/$/, '')}/?page=agents`)
  await page.getByRole('button', { name: /^(Adopt|Update|Review)/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Review application', exact: true })).toBeVisible({ timeout: 60_000 })
  await shot('adopt-review')
  await page.getByRole('button', { name: 'Adopt', exact: true }).click()
  await page.waitForTimeout(4000)
  await shot('adopted')
}

const APP = '@agnes-showcase/devboard#devboard'

/**
 * A plugin reload in the ISOLATED run, the way the dev sync does it: change a byte of the package source, install
 * it again (a new package integrity), wait until it runs, then re-adopt. Sessions opened before lose their store (CAPABILITY_DENIED).
 */
export async function hotReload({ state, cli, expect }) {
  const copy = join(dirname(state.home), 'devboard-src')
  await appendFile(join(copy, 'index.mjs'), `\n// hot reload ${Date.now()}\n`)
  await cli(['plugins', 'add', copy, '--yes'])
  await expect
    .poll(async () => (await cli(['plugins', 'status'])).stdout.split('\n').some((l) => l.includes('devboard@') && l.includes('actual=running')), { timeout: 60_000 })
    .toBe(true)
  await new Promise((r) => setTimeout(r, 3000))
  if (!(await cli(['app', 'show'])).stdout.startsWith('active')) await cli(['app', 'adopt', APP, '--yes'])
}

/** The dev sync in the ISOLATED run: change a byte of the watched `<home>/plugins/devboard` folder, wait until it runs again, re-adopt if the adoption came loose. */
export const adoptApp = ({ cli }) => cli(['app', 'adopt', APP, '--yes'])
export async function syncWatched({ state, cli, expect }, { readopt = true } = {}) {
  // the real dev sync changes client modules too, which the host swaps in the open page
  for (const f of ['index.mjs', 'client/assistant-session.js', 'client/assistant.js']) await appendFile(join(state.home, 'plugins', 'devboard', f), `\n// dev sync ${Date.now()}\n`)
  await new Promise((r) => setTimeout(r, 2000))
  await expect
    .poll(async () => (await cli(['plugins', 'status'])).stdout.split('\n').some((l) => l.includes('devboard@') && l.includes('actual=running')), { timeout: 60_000 })
    .toBe(true)
  await new Promise((r) => setTimeout(r, 5000))
  const app = (await cli(['app', 'show'])).stdout
  if (readopt && !app.startsWith('active')) {
    await cli(['app', 'adopt', APP, '--yes'])
    await new Promise((r) => setTimeout(r, 5000))
  }
  return app.split('\n')[0]
}
