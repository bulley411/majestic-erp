# Running with native PostgreSQL on Windows

You are skipping Docker locally and installing PostgreSQL directly.
This works fine. Four things differ from the container, and this covers
all of them.

---

## Install

Get **PostgreSQL 16** for Windows x86-64 from postgresql.org.

**Install 16, not 17.** Your VPS runs `postgres:16-alpine`. Version drift
between dev and production is the kind of thing that surfaces as a
migration behaving differently on deploy day.

During installation:

- Set a superuser password and write it down
- Keep port **5432**
- **Locale: set it to `C` or `en_US.UTF-8`**, not the Windows default

That locale setting is the one non-obvious step. See below for why.

Skip Stack Builder at the end.

---

## Create the database

Open **SQL Shell (psql)** from the Start menu. Press Enter through the
first four prompts to accept defaults, then enter your superuser password.

```sql
CREATE USER mapa WITH PASSWORD 'your_password';
CREATE DATABASE mapa_erp OWNER mapa ENCODING 'UTF8';
\c mapa_erp
GRANT ALL ON SCHEMA public TO mapa;
\q
```

That `GRANT` matters on Postgres 15+. Non-superusers lost default create
rights on the public schema, and without it Prisma fails on the first
migration with a permission error that does not obviously point at this.

In `.env`:

```
DATABASE_URL=postgresql://mapa:your_password@localhost:5432/mapa_erp
```

If your password contains `@`, `:`, `/` or `#`, URL-encode it or the
connection string will parse wrongly.

Then **skip Step 4** of SETUP.md and continue from Step 5.

---

## The four differences, and how each is handled

### 1. Timezone — handled in code

The Alpine container runs UTC. Windows runs your local timezone, WAT
(UTC+1) in Lagos.

This matters more than it sounds for payroll. A month-end journal entry
computed in local time can land in a different fiscal month than the same
computation on a UTC server. A July run posted from your laptop and the
same run posted in production could end up in different periods.

Fixed in two places:

- `apps/api/src/main.ts` sets `process.env.TZ = 'UTC'` before anything
  reads a date
- `apps/api/src/payroll/payroll-posting.service.ts` uses `Date.UTC` for
  the month-end calculation rather than the local-time constructor
- `docker-compose.yml` sets `TZ=UTC` and `PGTZ=UTC` on the VPS containers

Nothing for you to do. Just don't remove the `process.env.TZ` line — it
has to run before the first import that touches a date.

### 2. Collation — handled at install

The Windows installer defaults to a locale like
`English_United States.1252`. The container uses `en_US.utf8`.

Collation controls how text sorts. `ORDER BY lastName` can return a
genuinely different order under the two settings, particularly around
case and punctuation. Your employee directory is sorted server-side, so
this would show up as the list being ordered differently in production
than in dev — subtle, confusing, and easy to misread as a bug in the code.

Choosing `C` or `en_US.UTF-8` at install time avoids it. If you already
installed with the default, check:

```sql
SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'mapa_erp';
```

If it shows a `1252` collation, drop and recreate the database with
`LC_COLLATE='C' LC_CTYPE='C'`. Easier now than after you have data.

### 3. Line endings — handled by .gitattributes

Windows Git checks out CRLF by default. Those files then go into Linux
containers where shell scripts and some tooling break on the carriage
returns.

`.gitattributes` forces LF for all text files. If you already committed
before adding it:

```bash
git add --renormalize .
git commit -m "Normalise line endings"
```

### 4. Filename casing — needs your attention

Windows filesystems are case-insensitive. Linux is not.

`import Shell from './components/shell'` works on your laptop and fails
in CI with "module not found". This is the single most common way a
Windows-developed project breaks on first deploy, and it costs an hour
of confusion every time.

Nothing can fully automate this away. The habit that prevents it: when
importing, copy the filename rather than typing it.

Your GitHub Actions build runs on Linux, so it will catch these before
they reach the VPS — but only if you push before you deploy.

---

## Redis, later

Nothing uses Redis yet. When payroll background jobs need it:

- **Memurai** — native Windows Redis, free developer edition
- **Upstash** — hosted, free tier, just a connection string

Either way it is one `REDIS_URL` in `.env`. The VPS side already has
Redis in `docker-compose.yml`, so no production change is needed.

---

## Does this hurt production parity?

Not meaningfully. Same Postgres major version, same schema, same
migrations, same application code. The connection string changes and
nothing else.

What you lose is catching Docker-specific issues locally. Since your VPS
images are built in GitHub Actions on Linux, that pipeline is your real
parity check — and it is a better one than Docker Desktop would have been.
