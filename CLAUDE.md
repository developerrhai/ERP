# Rules for every Claude / AI session in this repo

These rules come from the owner (2026-11-02). They override any default behaviour.

## Git and deployment: never without explicit permission
1. **Never `git push`** to any remote (`origin`, `erp-old` or any other), not even "just to sync".
2. **Never deploy.** Do not run `deploy_to_ec2*.ps1`, `vercel`, `vercel deploy` or `pm2`, do not ssh/scp to the EC2 server, and do not change the live Nginx config. The owner deploys by hand.
3. **Never commit** unless the owner asks for a commit in that message. Work stays as uncommitted changes, so the owner can review it.
4. Never rewrite history (`reset --hard`, `rebase`, `push --force`, amend of pushed commits).
5. A request like "build phase N" means build and test **locally only**.

## Secrets
* Never print, copy or commit secrets. That covers:
  * `.env` values;
  * deploy-script passwords or keys;
  * the token inside the git remote URLs;
  * `*.pem` keys;
  * production credentials.
* Refer to them as "<redacted>".
* `deploy_to_ec2.ps1` and `deploy_to_ec2.local.ps1` are git-ignored because they contain secrets. Only `deploy_to_ec2.example.ps1` may be edited and committed.

## Databases
* Local only: `rhai_erp` (dev), `rhai_erp_test` (API tests, reset freely), `rhai_erp_e2e` (e2e, reset freely).
* Never touch the old database `erp` or any production database.

## How work is done here
* Spec first:
  * `PLAN.md`;
  * the per-phase `docs/phaseN/CONTRACT.md`.
* Then:
  * build;
  * run `npm run verify` and `npm run e2e` **three times from a clean DB**;
  * an independent review;
  * fix.
* Record the reason for every added or removed file in `docs/phaseN/CHANGES.md`.
* `index.html` (the prototype) is read-only.
