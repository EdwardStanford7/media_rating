APP_NAME = media-rating-web
D1_NAME = media-rating
R2_BUCKET = media-rating-images

.PHONY: help install check test typecheck build dev preview audit password-reset-link password-reset-link-local \
	auth-clear-rate-limits auth-clear-rate-limits-local \
	cf-login cf-whoami cf-create-d1 cf-create-r2 cf-secret-auth cf-secret-signup-invite \
	cf-secret-password-reset \
	cf-migrate-local cf-migrate-remote cf-reset-free-rank-remote \
	verify-deploy-config deploy deploy-first

help:
	@echo "Media Rating web commands"
	@echo ""
	@echo "Local:"
	@echo "  make install              Install npm dependencies"
	@echo "  make check                Run tests, typecheck, audit, and build"
	@echo "  make dev                  Start local dev server"
	@echo "  make cf-migrate-local     Apply D1 migrations to local Wrangler D1"
	@echo "  make password-reset-link EMAIL=user@example.com Generate a one-hour remote reset link"
	@echo "  make password-reset-link-local EMAIL=user@example.com Generate a local D1 reset link"
	@echo "  make auth-clear-rate-limits Clear remote auth rate-limit lockouts"
	@echo "  make auth-clear-rate-limits-local Clear local auth rate-limit lockouts"
	@echo ""
	@echo "Cloudflare setup:"
	@echo "  make cf-login             Authenticate Wrangler"
	@echo "  make cf-create-d1         Create D1 database and update wrangler.jsonc"
	@echo "  make cf-create-r2         Create R2 bucket and update wrangler.jsonc"
	@echo "  make cf-secret-auth       Generate and set BETTER_AUTH_SECRET"
	@echo "  make cf-secret-signup-invite Generate and set optional signup invite code"
	@echo "  make cf-secret-password-reset Set Resend password reset email secrets"
	@echo "  make cf-reset-free-rank-remote Reset remote free-rank Elo/matches after confirmation"
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

password-reset-link:
	@test -n "$(EMAIL)" || (echo "Usage: make password-reset-link EMAIL=user@example.com"; exit 1)
	node scripts/create-password-reset-link.mjs "$(EMAIL)"

password-reset-link-local:
	@test -n "$(EMAIL)" || (echo "Usage: make password-reset-link-local EMAIL=user@example.com"; exit 1)
	node scripts/create-password-reset-link.mjs "$(EMAIL)" http://localhost:5173 --local

auth-clear-rate-limits:
	node scripts/clear-auth-rate-limits.mjs

auth-clear-rate-limits-local:
	node scripts/clear-auth-rate-limits.mjs --local

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

cf-secret-signup-invite:
	@echo "Optional. Use this only if you want to create additional accounts after the first user."
	@code=$$(openssl rand -hex 12); \
	printf "%s" "$$code" | npx wrangler secret put SIGNUP_INVITE_CODE; \
	echo ""; \
	echo "Generated SIGNUP_INVITE_CODE: $$code"; \
	echo "Save this code now. Wrangler will not show it again."

cf-secret-password-reset:
	@echo "Set these after creating a Resend API key and verified sender/domain."
	npx wrangler secret put RESEND_API_KEY
	npx wrangler secret put PASSWORD_RESET_FROM_EMAIL

cf-migrate-local:
	npm run db:migrate:local

cf-migrate-remote:
	npm run db:migrate:remote

cf-reset-free-rank-remote:
	@echo "This deletes all remote free-rank matches and resets Elo/wins/losses for every non-deleted entry."
	@printf "Type RESET to continue: "; \
	read answer; \
	if [ "$$answer" = "RESET" ]; then \
		npx wrangler d1 execute $(D1_NAME) --remote --file scripts/reset-free-rank-data.sql; \
	else \
		echo "Cancelled."; \
	fi

verify-deploy-config:
	node scripts/verify-deploy-config.mjs

deploy: verify-deploy-config check cf-migrate-remote
	npm run deploy

deploy-first: install cf-login cf-create-d1 cf-create-r2 cf-secret-auth
	@echo ""
	@echo "Before running make deploy:"
	@echo "1. Set vars.BETTER_AUTH_URL in wrangler.jsonc to your production HTTPS URL."
	@echo "2. Run make deploy."
	@echo "3. Optional: run make cf-secret-signup-invite if you need to invite additional accounts."
