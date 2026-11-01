# @rhai/web

React 18 + TypeScript + Vite client for the RHAI ERP rebuild (Phase 0/1). The spec is
`docs/phase1/CONTRACT.md` §8; the visual source of truth is `reference/index.html`.

## Commands (run in `apps/web`)

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm install`       | Install dependencies (this package has its own lockfile)        |
| `npm run dev`       | Vite dev server (default http://localhost:5173), `/api` proxied |
| `npm run build`     | Type-check, then production build into `dist/`                  |
| `npm run preview`   | Serve `dist/` on port 4173 (same `/api` proxy)                  |
| `npm run lint`      | ESLint (no warnings allowed) + Prettier check                   |
| `npm run format`    | Prettier write                                                  |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)             |
| `npm test`          | Vitest + Testing Library (jsdom)                                |
| `npm run verify`    | lint + typecheck + test (the quality gate)                      |

## Environment variables

Read by `vite.config.ts` when the dev/preview server starts. Because of the `VITE_` prefix, Vite
also makes them visible as `import.meta.env.*`; the app does not use them there, and they are
not secrets.

| Variable          | Default                 | Purpose                                                   |
| ----------------- | ----------------------- | --------------------------------------------------------- |
| `VITE_PORT`       | `5173`                  | Dev server port (`strictPort`: fails if the port is busy) |
| `VITE_API_TARGET` | `http://localhost:4000` | Where `/api` is proxied (dev and preview)                 |

Example (PowerShell): `$env:VITE_PORT='5191'; $env:VITE_API_TARGET='http://localhost:4100'; npm run dev`

Example (Git Bash): `VITE_PORT=5191 VITE_API_TARGET=http://localhost:4100 npm run dev`

Because the browser only ever talks to the Vite origin, the API's refresh cookie
(`Path=/api/v1/auth`, `SameSite=Strict`) stays same-origin. If you change `VITE_PORT`, set the
API's `WEB_ORIGIN` to the matching origin.

## Notes

- The menu is read from `packages/registry/registry.json` through the `@registry` alias (never copied).
- The access token is held in memory only. The session is restored on load via `POST /auth/refresh`.
  Refreshes are single-flight within a tab and serialised across tabs with the Web Lock
  `rhai-auth-refresh`. Tabs announce logout and refresh on `BroadcastChannel('rhai-auth')`.
- Parity screenshots go to `.parity/` (git-ignored).
