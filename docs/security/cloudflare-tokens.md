Cloudflare API token

One token, in .env (gitignored, mode 600), keys `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Template: .env.example.

Every script reads it from there: scripts/dev-worker.sh, scripts/deploy-worker.sh, scripts/prod-logs.sh. Manual `wrangler secret put`, `wrangler rollback` and remote `wrangler d1` commands use it too.

Permissions

Account: Workers Scripts Edit, D1 Edit, Workers Tail Read, Workers AI Read, Account Settings Read. Zone `vrizo.net`: Workers Routes Edit. User: User Details Read, Memberships Read. Account resources: this account only.

Creating the token

1. Open dash.cloudflare.com, My Profile, API Tokens, Create Token, Create Custom Token, with the permissions above.
2. Paste it into .env with the account id. Run `chmod 600 .env`.
3. Check it: `scripts/deploy-worker.sh --check` must pass.
