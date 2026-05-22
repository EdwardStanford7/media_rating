# Media Rating Web

TanStack Start + Cloudflare Workers port of the Rust media ranking app.

## Implemented

- Better Auth email/password plus Google and Apple social providers.
- Cloudflare D1 schema for categories, entries, ranking sessions, and persisted match history.
- Cloudflare R2 image binding with stable entry-id image keys.
- Pure binary-search entry placement with every binary comparison saved as a `binary_search` match.
- Entry rename, delete, rerank, and switch-category flows.
- Free Rank mode with a category dropdown plus `Any`; `Any` chooses a random eligible category before each matchup.
- Free-rank Elo, wins, and losses saved on entries, with `free_rank` match rows retaining Elo before/after values.
- Binary, Free Rank, and bounded Combined display modes.
- Legacy xlsx import with an optional default first-consumed date.
- xlsx export with the legacy `Sorted` sheet and entry metadata.

## Local Setup

This folder expects Node.js and npm or pnpm.

```sh
cd web
npm install
cp .env.example .env
npm run db:migrate:local
npm run dev
```

Create Cloudflare D1/R2 resources before remote deploy, then replace the placeholder `database_id` in `wrangler.jsonc`.

## OAuth Redirects

Register these local redirect URLs while developing:

- Google: `http://localhost:3000/api/auth/callback/google`
- Apple: `http://localhost:3000/api/auth/callback/apple`

Production redirects should use the deployed domain with the same paths.

## Verification

```sh
npm run typecheck
npm run test
npm run build
```

The repo machine used for scaffolding did not have `node`, `npm`, or `pnpm` installed, so these commands need to be run after installing Node tooling.

## Make Targets

The `Makefile` wraps the common local and deploy commands:

```sh
make check
make cf-migrate-local
make deploy-first
make deploy
```

`make deploy-first` handles Wrangler login, D1/R2 creation, and interactive secret entry. Before `make deploy`, set `BETTER_AUTH_URL` in `wrangler.jsonc` to the production HTTPS URL and configure Google/Apple OAuth callback URLs.
