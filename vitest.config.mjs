import { homedir } from 'node:os'
import { join } from 'node:path'

// The tests were written inside the open-source repo; point its relative and workspace imports at a local checkout.
const harness = process.env.AGNES_HARNESS ?? join(homedir(), 'agnes-harness')

export default {
  resolve: {
    alias: [
      { find: /^(?:\.\.\/){4}packages\//, replacement: `${harness}/packages/` },
      { find: '@agnes/web-client', replacement: new URL('./test/stubs/web-client.js', import.meta.url).pathname },
      { find: '@agnes/web-ui', replacement: new URL('./test/stubs/web-ui.js', import.meta.url).pathname },
      // This repo has no node_modules; the component test renders with the checkout's React.
      { find: /^react(-dom)?(\/.*)?$/, replacement: `${harness}/packages/web-ui/node_modules/react$1$2` },
    ],
  },
  server: { fs: { allow: [harness, '.'] } },
  test: { include: ['test/**/*.test.ts'], exclude: process.env.DEVBOARD_E2E ? [] : ['test/**/*.e2e.test.ts'] },
}
