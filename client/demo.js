import React from 'react'
import { h } from './board.js'
import * as assistantRun from './demo/assistant-run-demo.js'
import * as watchCenter from './demo/watch-center.js'

/**
 * Demo pages by entry id. Each module exports { css, html, run(root) }: a design mock turned into a script
 * that runs inside a shadow root. The host CSP (script-src 'self', style-src 'self') rules out an iframe of
 * inline HTML, and client assets cannot be .html, so the mock ships as a module; its CSS goes in through a
 * constructable stylesheet, which the CSP allows, and the shadow root keeps it from touching the page.
 */
const DEMOS = { 'assistant-demo': assistantRun, 'watch-demo': watchCenter }

export function Demo({ id }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const demo = DEMOS[id]
    const el = ref.current
    if (!demo || !el) return undefined
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(demo.css)
    // document rules beat :host rules, and the host page lays divs out as flex; set the box inline (CSSOM, allowed by the CSP)
    Object.assign(el.style, { display: 'block', width: '100%', minWidth: '0', minHeight: '100dvh' })
    root.adoptedStyleSheets = [sheet]
    root.innerHTML = demo.html
    // The mock follows the OS colour scheme; inside the workbench it follows the host theme (html.dark).
    const root$ = document.documentElement
    const theme = () => el.toggleAttribute('data-dark', root$.classList.contains('dark'))
    theme()
    const observer = new MutationObserver(theme)
    observer.observe(root$, { attributes: true, attributeFilter: ['class'] })
    const stop = demo.run(root)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [id])
  return h('div', { ref, className: 'devboard-demo' })
}
