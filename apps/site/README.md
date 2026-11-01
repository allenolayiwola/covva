# Covva marketing site (`@im/site`, Vercel project covva-site)

The public marketing pages. Sign-in, accounts, the partner workspace, the quote flow, APIs and crons live in the
app (`apps/web`, covva-app). How the two link up, and the environment variables: `docs/APPS.md`.

```bash
pnpm --filter @im/site dev     # http://localhost:3100
pnpm --filter @im/site test    # unit tests
pnpm --filter @im/site e2e     # browser tests (needs a build)
```

Read `AGENTS.md` first: this Next.js version has breaking changes.
