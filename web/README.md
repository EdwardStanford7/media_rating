# Rankly Web

TanStack Start + Cloudflare Workers port of the Rust media ranking app.

## Implemented

- Better Auth email/password authentication.
- Cloudflare D1 schema for categories, entries, ranking sessions, queue state, and user settings.
- Cloudflare R2 image binding with stable entry-id image keys.
- Binary-search entry placement with local repair checks and random audit operations.
- Entry rename, delete, rerank, and switch-category flows.
- Legacy xlsx import with an optional default first-consumed date.
- Imported entries start without images. Images can be picked later from an 18-result search popup or uploaded manually.
- Ranking comparisons prompt for one missing image at a time instead of fetching images during import.
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

The app uses email/password auth only. Account creation is open on the sign-in page and protected by Better Auth password hashing and rate limits.

Password reset uses Better Auth reset tokens and sends email through Resend. Create a Resend API key and verified sender or domain, then run:

```sh
make cf-secret-password-reset
```

Set `RESEND_API_KEY` to the API key and `PASSWORD_RESET_FROM_EMAIL` to the sender address, such as `<reset@your-domain.com>`. If those values are missing, reset links are written to Worker logs for local/dev testing but no email is sent.

For one-off admin recovery before email sending is configured, generate a reset link directly from D1:

```sh
make password-reset-link EMAIL=user@example.com
```

Passwords are stored as hashes in the `account` table, so they cannot be viewed or recovered manually.

If testing sign-in repeatedly triggers a temporary auth lockout, clear only the auth rate-limit rows:

```sh
make auth-clear-rate-limits
```

This does not delete users, passwords, sessions, or app data.

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
