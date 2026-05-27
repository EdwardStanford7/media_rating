# Media Rating Web

TanStack Start + Cloudflare Workers port of the Rust media ranking app.

## Implemented

- Better Auth email/password authentication.
- Cloudflare D1 schema for categories, entries, ranking sessions, and persisted match history.
- Cloudflare R2 image binding with stable entry-id image keys.
- Pure binary-search entry placement with every binary comparison saved as a `binary_search` match.
- Entry rename, delete, rerank, and switch-category flows.
- Free Rank mode with a category dropdown plus `Any`; `Any` chooses a random eligible category before each matchup.
- Free-rank Elo, wins, and losses saved on entries, with `free_rank` match rows retaining Elo before/after values.
- Binary, Free Rank, and bounded Combined display modes.
- Legacy xlsx import with an optional default first-consumed date.
- Imported entries start without images. Images can be picked later from an 18-result search popup or uploaded manually.
- Binary/free-rank comparisons prompt for one missing image at a time instead of fetching images during import.
- Optional entry queue with a user-configurable delay before new entries become ready for binary ranking.
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

## Auth

The app uses email/password auth only. The first account can sign up normally. After a user exists, server-side signup closes by default so the public Workers URL cannot be used to create random accounts.

To create additional accounts later, generate and set an invite code secret:

```sh
make cf-secret-signup-invite
```

The command prints the generated invite code once after uploading it to Wrangler.

Password reset uses Better Auth reset tokens and sends email through Resend. Create a Resend API key and verified sender or domain, then run:

```sh
make cf-secret-password-reset
```

Set `RESEND_API_KEY` to the API key and `PASSWORD_RESET_FROM_EMAIL` to the sender address, such as `Media Rating <reset@your-domain.com>`. If those values are missing, reset links are written to Worker logs for local/dev testing but no email is sent.

For one-off admin recovery before email sending is configured, generate a reset link directly from D1:

```sh
make password-reset-link EMAIL=user@example.com
```

Passwords are stored as hashes in the `account` table, so they cannot be viewed or recovered manually.

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
make cf-secret-password-reset
make password-reset-link EMAIL=user@example.com
```

`make deploy-first` handles Wrangler login, D1/R2 creation, and auth secret setup. Before `make deploy`, set `BETTER_AUTH_URL` in `wrangler.jsonc` to the production HTTPS URL.
