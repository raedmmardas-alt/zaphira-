/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    // server/ is a separate local Node backend with its own package.json
    // and its own test runner (node --test, run via `npm test` inside
    // server/) -- excluded here (on top of vitest's own defaults, which an
    // explicit `exclude` array otherwise replaces) so a fresh checkout that
    // hasn't run `npm install` inside server/ can't break the frontend's
    // `npx vitest run`, and so backend tests never run twice under two
    // different runners.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'server/**',
    ],
  },
})
