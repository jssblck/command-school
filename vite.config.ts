import { defineConfig } from 'vite'

/**
 * A GitHub project page is served from /<repo>/, so every built asset URL has to
 * carry that prefix or the page loads a blank canvas and nothing else. The prefix
 * is the repository's own name, which only the deploy knows, so it comes out of
 * the environment rather than being written down here: a user page and the dev
 * server both serve from the root and want no prefix at all.
 */
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

export default defineConfig({
  base,
  server: { port: 5273 },
  build: { target: 'es2022' },
})
