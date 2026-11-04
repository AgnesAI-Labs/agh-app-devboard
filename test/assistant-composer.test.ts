// @vitest-environment happy-dom
import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const spies = vi.hoisted(() => ({ markdown: 0, sent: [] as string[], sendFails: false, follow: undefined as undefined | ((e: any) => void) }))

vi.mock('../client/assistant-session.js', () => ({
  assistantFor: () => ({
    notice: '',
    ensure: async () => {},
    follow: (on: (e: any) => void) => {
      spies.follow = on
      return () => {}
    },
    send: async (t: string) => {
      spies.sent.push(t)
      if (spies.sendFails) throw new Error('boom')
    },
    onReleased: () => () => {},
    onPermissionRequest: () => () => {},
    pendingApprovals: async () => [],
    onParked: () => () => {},
    currentModel: async () => undefined,
    models: async () => [],
  }),
}))
vi.mock('../client/assistant-model.js', async (orig) => {
  const m: any = await orig()
  return { ...m, markdownBlocks: (t: string) => (spies.markdown++, m.markdownBlocks(t)) }
})

import { Assistant } from '../client/assistant.js'
import { TruncatedNotice } from '../client/board.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const board = { data: { projects: [], gates: [], interventions: [], waits: [], stages: [], assistant: {} }, error: '', refresh: async () => {}, busy: false }
let root: ReturnType<typeof createRoot> | undefined
const host = () => document.querySelector('[data-devboard-page="assistant"]') as HTMLElement
const ta = () => host().querySelector('textarea') as HTMLTextAreaElement
const sendBtn = () => host().querySelector('button[type="submit"]') as HTMLButtonElement
const type = (el: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const key = (el: HTMLElement, init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(e)
  return e
}
const mount = async (events = 0) => {
  const div = document.createElement('div')
  document.body.append(div)
  root = createRoot(div)
  await act(async () => root!.render(React.createElement(Assistant as any, { ctx: {}, board })))
  await act(async () => {
    for (let i = 1; i <= events; i++) spies.follow!({ seq: i, type: i % 2 ? 'user/message' : 'assistant/message', data: { content: [{ type: 'text', text: `message ${i} **bold**` }] } })
  })
}
beforeAll(() => {
  HTMLFormElement.prototype.requestSubmit ??= function () {
    this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }
})
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  spies.sent.length = 0
  spies.sendFails = false
})

describe('assistant composer', () => {
  it('typing does not re-render the conversation', async () => {
    await mount(300)
    const before = spies.markdown
    expect(before).toBeGreaterThan(0)
    const text = 'x'.repeat(600)
    const t0 = performance.now()
    for (let i = 1; i <= 100; i++) await act(async () => type(ta(), text.slice(0, i * 6)))
    const ms = performance.now() - t0
    console.log(`BENCH 300 events, 100 keystrokes: ${ms.toFixed(0)} ms, markdown renders during typing: ${spies.markdown - before}`)
    expect(spies.markdown - before).toBe(0)
    expect(ta().value).toHaveLength(600)
  })

  it('Enter sends and clears; Shift+Enter, IME Enter and an empty draft do not send', async () => {
    await mount()
    expect(sendBtn().disabled).toBe(true)
    await act(async () => type(ta(), '  hello  '))
    expect(sendBtn().disabled).toBe(false)
    await act(async () => void key(ta(), { key: 'Enter', shiftKey: true }))
    await act(async () => void key(ta(), { key: 'Enter', keyCode: 229 }))
    expect(spies.sent).toEqual([])
    await act(async () => void key(ta(), { key: 'Enter' }))
    expect(spies.sent).toEqual(['hello'])
    expect(ta().value).toBe('')
    await act(async () => void key(ta(), { key: 'Enter' }))
    expect(spies.sent).toEqual(['hello'])
  })

  it('a failed send restores the draft and shows the error', async () => {
    await mount()
    spies.sendFails = true
    await act(async () => type(ta(), 'keep me'))
    await act(async () => void key(ta(), { key: 'Enter' }))
    expect(ta().value).toBe('keep me')
    expect(host().querySelector('[role="alert"]')?.textContent).toContain('发送失败：boom')
  })

  it('a Welcome prompt pick fills and focuses the composer', async () => {
    await mount()
    const pick = host().querySelector('.devboard-assistant-suggest button') as HTMLButtonElement
    await act(async () => pick.click())
    expect(ta().value).toBe(pick.textContent)
    expect(document.activeElement).toBe(ta())
  })

  it('says which lists the board read left out when it was truncated', async () => {
    const data: any = board.data
    data.truncated = true
    data.truncatedKeys = ['activity', 'defects']
    try {
      await mount()
      expect(host().textContent).toContain('看板数据较多，部分列表未完整显示：动态、缺陷')
    } finally {
      delete data.truncated
      delete data.truncatedKeys
    }
    await act(async () => root?.unmount())
    document.body.innerHTML = ''
    await mount()
    expect(host().textContent).not.toContain('看板数据较多')
  })

  it('the board pages show the same notice, and none for a whole read', async () => {
    const div = document.createElement('div')
    document.body.append(div)
    root = createRoot(div)
    const render = (data: any) => act(async () => root!.render(React.createElement(TruncatedNotice as any, { data })))
    await render({ truncated: true, truncatedKeys: ['faults', 'trials'] })
    expect(div.textContent).toContain('看板数据较多，部分列表未完整显示：预警、试验')
    await render({ truncated: false })
    expect(div.textContent).toBe('')
  })
})
