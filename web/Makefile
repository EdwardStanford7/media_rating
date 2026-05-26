APP_NAME = media-rating-web
D1_NAME = media-rating
R2_BUCKET = media-rating-images

.PHONY: help install check test typecheck build dev preview audit \
	cf-login cf-whoami cf-create-d1 cf-create-r2 cf-secrets cf-secret-auth \
	cf-migrate-local cf-migrate-remote verify-deploy-config deploy deploy-first

help:
	@echo "Media Rating web commands"
	@echo ""
	@echo "Local:"
	@echo "  make install              Install npm dependencies"
	@echo "  make check                Run tests, typecheck, audit, and build"
	@echo "  make dev                  Start local dev server"
	@echo "  make cf-migrate-local     Apply D1 migrations to local Wrangler D1"
	@echo ""
	@echo "Cloudflare setup:"
	@echo "  make cf-login             Authenticate Wrangler"
	@echo "  make cf-create-d1         Create D1 database and update wrangler.jsonc"
	@echo "  make cf-create-r2         Create R2 bucket and update wrangler.jsonc"
	@echo "  make cf-secret-auth       Generate and set BETTER_AUTH_SECRET"
	@echo "  make cf-secrets           Prompt for Google/Apple OAuth secrets"
	@echo ""
	@echo "Deploy:"
	@echo "  make verify-deploy-config Validate wrangler.jsonc production settings"
	@echo "  make deploy               Verify, migrate remote D1, and deploy"
	@echo "  make deploy-first         Run the first-time Cloudflare setup sequence"

install:
	npm install

test:
	npm run test

typecheck:
	npm run typecheck

build:
	npm run build

audit:
	npm audit --omit=dev

check: test typecheck audit build

dev:
	npm run dev

preview:
	npm run preview

cf-login:
	npx wrangler login

cf-whoami:
	npx wrangler whoami

cf-create-d1:
	node scripts/create-d1-if-needed.mjs $(D1_NAME)

cf-create-r2:
	@echo "If this fails with Cloudflare code 10042, enable R2 in the Cloudflare dashboard first."
	node scripts/create-r2-if-needed.mjs $(R2_BUCKET)

cf-secret-auth:
	openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET

cf-secrets:
	@echo "Enter each value at Wrangler's prompt. Values will not be committed."
	npx wrangler secret put GOOGLE_CLIENT_ID
	npx wrangler secret put GOOGLE_CLIENT_SECRET
	npx wrangler secret put APPLE_CLIENT_ID
	npx wrangler secret put APPLE_CLIENT_SECRET

cf-migrate-local:
	npm run db:migrate:local

cf-migrate-remote:
	npm run db:migrate:remote

verify-deploy-config:
	node scripts/verify-deploy-config.mjs

deploy: verify-deploy-config check cf-migrate-remote
	npm run deploy

deploy-first: install cf-login cf-create-d1 cf-create-r2 cf-secret-auth cf-secrets
	@echo ""
	@echo "Before running make deploy:"
	@echo "1. Set vars.BETTER_AUTH_URL in wrangler.jsonc to your production HTTPS URL."
	@echo "2. Configure Google redirect URL: https://your-domain/api/auth/callback/google"
	@echo "3. Configure Apple return URL: https://your-domain/api/auth/callback/apple"
