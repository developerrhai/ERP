# Move the ERP backend to server 3

| | From | To |
|---|---|---|
| Server | 1, HealthCoreX `13.204.199.132` (t3.micro) | 3, Institutemanage `3.110.78.177` (t3a.small) |
| API address | `institute-api.rhaitech.online/sawant-erp` | `dnyansagarclasses.rhaitech.online/sawant-erp` |
| Frontend | Vercel, calls the old address | Vercel, calls the new address |

Only the ERP moves. The other apps on both servers stay. Choose one way:

| Step 3 | Code on server 3 | Database on server 3 |
|---|---|---|
| `deploy` | this laptop's code, including uncommitted changes | new and empty, with default setup and one admin |
| `copy` | copied from server 1 | copied from server 1, with uploaded files |

The owner chose **`deploy`** on 2026-11-28, because the data on server 1 is demo
data. Both ways take the settings (`.env`) from server 1, and leave server 1's
database untouched.

These scripts have been syntax-checked and partly simulated on a laptop. They
have **never run against the real servers**, so do the practice steps first.

**No DNS change is needed.** The ERP is added as the path `/sawant-erp/` on the
HTTPS site server 3 already has. That means the ERP depends on that site: if the
`dnyansagarclasses` domain, certificate or Nginx file changes, check the ERP too.
Old links to `institute-api` keep working through the forwarder on server 1.

## Before you start (AWS console)

- [ ] Take an EBS snapshot (or AMI) of **both** servers.
- [ ] Check that `3.110.78.177` is an **Elastic IP**. If it is not, the address
      changes when the instance is stopped. Attaching an Elastic IP also changes
      it, so then update `dnyansagarclasses.rhaitech.online` too.
- [ ] Server 3 security group: ports 80 and 443 open, port 22 from your IP.
      Do not open 5010 or 5432.
- [ ] If server 1 has an **AWS role** (for S3 uploads or SES email), give server 3
      the same permissions. `check` prints both roles.
- [ ] If an SMS, email, payment or database service only allows server 1's IP,
      add `3.110.78.177`.

## Setup (once)

Open **Git Bash** (not PowerShell):

```bash
cd /c/Users/admin/Desktop/erp/ops/ec2-migration
cp config.example.sh config.sh
notepad config.sh        # set SRC_KEY and DST_KEY
```

`config.sh` is git-ignored. Each script step that changes something asks you to
type a word first.

## Steps, in order

| # | Command | What it does | ERP downtime |
|---|---|---|---|
| 1 | `./migrate.sh check` | Reads both servers. Reports RAM, disk, versions, database, Nginx, cron, conflicts. | none |
| 2 | `./migrate.sh prepare` | Server 3: swap file, same Node version (under `/opt/node`), PostgreSQL. | none |
| 3 | `./migrate.sh deploy` | Builds the backend here, uploads it, installs Node 20 and packages, creates the empty database and asks you for the first admin login. | none |
| 3 (other way) | `./migrate.sh copy` | Practice copy of server 1's database and files. Compares row counts. | none |
| 4 | `./migrate.sh web` | Server 3: adds `/sawant-erp/` to the existing site (backs the file up, tests, reloads). | none |
| 5 | `./migrate.sh test` | Starts the copied app for a health check, then stops it. | none |
| 6 | `./migrate.sh cutover` | The real move (below). | a few minutes; depends on size |
| 7 | `./migrate.sh frontend` | Changes the address in the local `vercel.json` files. You commit and push. | none |

**Read the output of step 1 before going on.** Compare the Nginx lines it prints
from server 1 with the block in the `cmd_web` part of `migrate.sh`. If server 1
has extra settings (larger upload size, extra headers, other paths to port 5010),
add them to the script before step 4.

**Step 5 warning (after `copy` only):** the copy holds real data. Queued jobs can
send real emails or messages while the test app runs. Skip it if you cannot accept
that.

**After `deploy`:** cutover copies nothing from server 1; users get the empty
database. The web app must match the new backend, so commit and push the matching
`apps/web` and `packages` changes right after cutover (Vercel redeploys). The
first login must change the temporary password.

## What cutover does

1. Runs `check` again.
2. Stops the ERP on server 1.
3. Copies the database and files a final time; row counts must match exactly.
4. Starts the ERP on server 3 and tests it through `https://dnyansagarclasses.rhaitech.online`.
5. If anything up to here fails, it starts the ERP on server 1 again.
6. Replaces the app on server 1 with a small forwarder (`forwarder.js`) on port
   5010, so the old address keeps working and the current frontend needs no
   immediate change. Server 1's Nginx is not edited.

If only step 6 fails, run `./migrate.sh forward`.

Do it at a quiet time. Switch off ERP cron jobs on server 1 first (step 1 lists
them) and create them on server 3 afterwards.

After cutover, test in the browser: sign in, create and save a record, upload a
file, open an **old** attachment, print a PDF, check notifications.

## Frontend

Run step 7, then:

1. In Vercel, open **Settings > Environment Variables**. If `VITE_API_BASE_URL`
   points to the old address, change it to
   `https://dnyansagarclasses.rhaitech.online/sawant-erp/api/v1`.
2. Commit only `vercel.json` and `apps/web/vercel.json`, then push.
   `apps/web/.env.production` is git-ignored and stays on your laptop.
3. Users may need to sign in again.

## Rollback

```bash
./migrate.sh rollback
```

Starts the ERP on server 1 again and stops it on server 3. **Data entered after
cutover is not copied back.** The script saves a dump of server 3's database in
`~/ec2-migration/` there first. If you changed the frontend, revert that commit.

## Afterwards

- Set up **database backups** on server 3.
- Point your private deploy script at server 3 (address and key). Do not run an
  old script that edits Nginx without reading it.
- Point any attendance agent or device that uses the old address to the new one.
- After a week or more: when server 1's Nginx logs show no `/sawant-erp`
  requests, run `pm2 delete erp-forwarder && pm2 save` there. Keep the old
  database until you have a backup you trust.
- Delete `~/ec2-migration/` on both servers (it holds app settings). Keep it
  until you no longer need rollback.
