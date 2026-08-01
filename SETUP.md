# Majestic APA ERP — setup on Windows without Docker

Complete steps from a fresh extract to a running system.

Every step has a **Checkpoint**. If one fails, stop there and send me the
exact error rather than continuing — a failure at step 8 produces
confusing symptoms at step 12.

Use **PowerShell**, not Git Bash.

---

## Step 1 — Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 22 LTS | `node -v` |
| pnpm | 9+ | `pnpm -v` |
| Git | any | `git -v` |

If pnpm is missing:

```powershell
npm install -g pnpm@9
```

No Docker. No WSL.

**Checkpoint:** all three commands print a version.

---

## Step 2 — Install PostgreSQL 16

Download **PostgreSQL 16** for Windows x86-64 from postgresql.org.

Install **16, not 17**. Your VPS runs `postgres:16-alpine`, and version
drift between dev and production surfaces as migrations behaving
differently on deploy day.

During the installer:

| Prompt | Value |
|---|---|
| Components | Keep defaults. pgAdmin is useful; Stack Builder is not |
| Password | Set one for the `postgres` superuser and write it down |
| Port | `5432` |
| **Locale** | **`C`** — do not accept the Windows default |

The locale is the one non-obvious choice. The Windows default is
something like `English_United States.1252`; the container uses UTF-8.
Collation controls how text sorts, so `ORDER BY lastName` can return a
genuinely different order under the two. Your employee directory sorts
server-side, so it would appear as the list being ordered differently in
production than in dev — subtle, and easy to misread as a code bug.

Untick Stack Builder at the end.

**Checkpoint:** Start menu contains "SQL Shell (psql)".

---

## Step 3 — Create the database

Open **SQL Shell (psql)** from the Start menu. Press Enter through the
first four prompts (Server, Database, Port, Username) to accept defaults,
then enter the superuser password from step 2.

Paste these one at a time:

```sql
CREATE USER mapa WITH PASSWORD 'choose_a_password';
CREATE DATABASE mapa_erp OWNER mapa ENCODING 'UTF8';
\c mapa_erp
GRANT ALL ON SCHEMA public TO mapa;
\q
```

That `GRANT` is required. Postgres 15 removed default create rights on
the `public` schema for non-superusers, and without it your first
migration fails with a permission error that does not obviously point
back to this step.

**Checkpoint:**

```powershell
psql -U mapa -d mapa_erp -c "SELECT current_database();"
```

If `psql` is not recognised, it is not on your PATH. Either add
`C:\Program Files\PostgreSQL\16\bin` to PATH, or use SQL Shell for every
psql command in this guide.

---

## Step 4 — Extract and initialise Git

```powershell
tar -xzf majestic-erp.tar.gz
cd majestic-erp

git init
git add .
git commit -m "Initial scaffold"
```

Do not skip the commit. From here I send you individual files, and
`git diff` is how you see exactly what changed before accepting anything.

**Checkpoint:** `git log --oneline` shows one commit.

---

## Step 5 — Environment file

```powershell
Copy-Item .env.example .env
```

Generate a JWT secret:

```powershell
node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
```

Open `.env` and set:

```
DATABASE_URL=postgresql://mapa:choose_a_password@localhost:5432/mapa_erp
JWT_SECRET=<the string you just generated>
NODE_ENV=development
VITE_API_URL=http://localhost:3000
```

`localhost` is correct — Postgres runs natively now, not in a container.

If your password contains `@`, `:`, `/`, `?` or `#`, URL-encode it or the
connection string parses wrongly. Simplest fix is a password without them.

The `POSTGRES_*` variables in `.env.example` are only used by Docker on
the VPS. Leave them; they are harmless locally.

**Checkpoint:** `.env` exists. It is already in `.gitignore` — never
commit it.

---

## Step 6 — Install dependencies

```powershell
pnpm install
```

Two to three minutes on first run. Peer-dependency warnings are normal.

**Checkpoint:** ends without `ERR_PNPM`.

---

## Step 7 — Generate the Prisma client

```powershell
pnpm --filter @mapa/api exec prisma generate
```

This reads `schema.prisma` and writes the typed database client. Nothing
in the API compiles until it has run.

**Re-run this after every schema change.** It is the most common cause of
"module has no exported member" errors later.

**Checkpoint:** prints `Generated Prisma Client`.

---

## Step 8 — Create the schema

```powershell
pnpm --filter @mapa/api exec prisma migrate dev --name init
```

This creates all tables, then applies `99999999999999_ledger_guards`,
which installs the triggers enforcing double-entry balance and making
posted journal entries immutable.

**Checkpoint:** two migrations applied. Verify the guards landed:

```powershell
psql -U mapa -d mapa_erp -c "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname;"
```

Five triggers, including `journalline_balance_check` and
`journalentry_immutable`. If you see zero, the guards migration did not
run — stop and tell me.

---

## Step 9 — Seed reference data

```powershell
pnpm --filter @mapa/api exec tsx prisma/seed.ts
```

Loads the chart of accounts, your four banks, five roles with permission
sets, all 28 checklist document types, the 40/25/15/10/10 salary
structure, the 2026 PAYE bands, and 12 fiscal periods.

**Checkpoint:** last line reads
`Voucher threshold: ED up to NGN 500,000, MD above.`

That 500,000 is my placeholder. Tell me the real figure and it becomes a
one-line change.

---

## Step 10 — Seed demo employees

```powershell
pnpm --filter @mapa/api exec tsx prisma/seed-demo.ts
```

Fifteen employees with varied file completeness so the directory has
something to show.

**Checkpoint:** `Seeded 15 demo employees with file records.`

Delete `prisma/seed-demo.ts` once your real staff are loaded.

---

## Step 11 — Start the API

Leave this terminal running.

```powershell
pnpm --filter @mapa/api dev
```

**Checkpoint:** `API listening on http://localhost:3000/api`

In a second terminal:

```powershell
curl.exe http://localhost:3000/api/health
curl.exe http://localhost:3000/api/employees
```

Expect `{"status":"ok","database":"connected",...}` and then a JSON array
starting with Aminu Ahmad.

> Use `curl.exe`, not `curl`. In PowerShell, bare `curl` is an alias for
> `Invoke-WebRequest` and prints a different format.

---

## Step 12 — Start the web app

Third terminal.

```powershell
pnpm --filter @mapa/web dev
```

**Checkpoint:** open **http://localhost:5173**

Fifteen employee cards on a navy rail layout, each with a gold
file-completeness meter. Grace Nwachukwu shows the most gaps; Joel Kure
is nearly complete. Typing in the search box filters live against the API.

---

## Step 13 — Run the tests

```powershell
pnpm --filter @mapa/shared test
pnpm --filter @mapa/api test
```

39 checks: 12 payroll, 13 approval chain, 14 voucher routing.

Run these before every commit. They are pinned to your real July 2026
figures, so a failure means an actual regression, not a flaky test.

---

## Troubleshooting

**`psql: command not found`** — add `C:\Program Files\PostgreSQL\16\bin`
to PATH, or use SQL Shell from the Start menu.

**`password authentication failed for user "mapa"`** — the password in
`.env` does not match step 3, or it contains a character needing
URL-encoding.

**`permission denied for schema public`** — the `GRANT` in step 3 was
skipped. Re-run it.

**`Module '@prisma/client' has no exported member`** — step 7 was skipped,
or the schema changed since. Re-run `prisma generate`.

**`Can't reach database server at localhost:5432`** — the service is not
running:

```powershell
Get-Service postgresql*
Start-Service postgresql-x64-16
```

**`EADDRINUSE :::3000`** — something else holds the port:

```powershell
netstat -ano | findstr :3000
```

**Web shows "Could not load employees"** — the API is not running or has
crashed. Check terminal 1.

**Directory loads but is empty** — step 10 did not run.

---

## What you have, and what you don't

Working:

- Postgres schema with ledger integrity enforced by database triggers
- Payroll engine verified against your July 2026 sheet
- Payroll approval chain with segregation of duties
- Voucher approval routing by threshold
- Employee directory, API and UI
- Health endpoint

Not built yet:

- **Authentication.** The API is completely open. Keep it on localhost and
  do not enter real staff data — bank accounts, RSA PINs, salaries — until
  auth exists. Demo data only.
- Employee create and edit forms
- Payroll run execution and ledger posting endpoint
- Voucher entry
- Reports

---

## When it is running

Send me:

```powershell
git log --oneline -1
```

and confirm which checkpoints passed. From then on I send individual
files with their paths — you drop them in, `git diff` to review, commit
if you are happy. No more archives.

Auth is what I would build next. It is what stands between this and your
real employee data.
