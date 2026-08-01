# Deploying to the Dokploy VPS

Your server runs Dokploy on Docker Swarm with a managed Traefik v3.6.7.
The existing `majestic-apa-public-gdrqnd` project sits on the same host,
so nothing here touches its config.

## 1. DNS

Point two A records at the VPS:

| Record | Purpose |
|---|---|
| `erp.majesticpensionagent.tech` | web app |
| `api.majesticpensionagent.tech` | API |

Let these resolve before deploying — Let's Encrypt validates over HTTP
and will fail on a domain that doesn't yet point at the box.

## 2. Create the Dokploy application

In Dokploy: **Create Service → Compose** (not *Stack* — Stack mode drops
`build`, and this repo builds from source).

- Provider: your Git repo, `main` branch
- Compose path: `docker-compose.yml`
- Additional compose file: `docker-compose.prod.yml`

Use **Preview Compose** before the first deploy. It shows the merged file
Dokploy will actually run, including any labels it injects itself.

## 3. Environment

Set these in Dokploy's Environment tab. Dokploy writes them to a `.env`
next to the compose file and passes `--env-file`.

```
POSTGRES_USER=mapa
POSTGRES_PASSWORD=<openssl rand -base64 32>
POSTGRES_DB=mapa_erp
JWT_SECRET=<openssl rand -base64 48>
NODE_ENV=production
VITE_API_URL=https://api.majesticpensionagent.tech
```

Environment changes need a rebuild — Dokploy does not hot-reload them.

## 4. Domains

Two options, pick one and don't mix them:

**A. Labels in `docker-compose.prod.yml`** (what this repo ships). Explicit
and version-controlled. Edit the two `Host(...)` rules if your domains differ.

**B. Dokploy's Domain tab.** Add a domain per service in the UI and Dokploy
injects the labels itself. Simpler, but the routing then lives in Dokploy's
database rather than your repo.

If you take option B, delete the `labels:` blocks from `docker-compose.prod.yml`
first, or you'll get two routers competing for the same host rule.

## 5. Deploy

Click Deploy. Then run migrations once:

```bash
docker compose -p <project-name> exec api pnpm --filter @mapa/api exec prisma migrate deploy
```

Get `<project-name>` from Dokploy's **Show Command** button.

## 6. Backups

Dokploy's **Volume Backups** works on named volumes, and `db_data` is one.
Enable it, schedule nightly, and set a destination off this server — S3, B2,
or anywhere that isn't the same disk.

Payroll data on a single VPS with no off-box copy is one disk failure from a
very bad month. Do this before you put real employees in.

---

## Two things to check on your side

**1. Traefik v3 needs backticks in rule values.** The labels you sent read:

```
traefik.http.routers.apa-staging.rule=Host(staging.majesticpensionagent.tech)
```

Traefik v3 requires `` Host(`staging.majesticpensionagent.tech`) ``. Without
backticks the router fails to parse and the route silently doesn't register.
Since that site is presumably working, the backticks are most likely there and
just got lost when you pasted. Worth a glance at the real file.

**2. Server resources.** You'll be adding Postgres, Redis, an API and a web
container alongside Dokploy and the existing project. Send me:

```bash
free -h
nproc
df -h /
```

Postgres and the Node build step are the memory-hungry parts. If the box is
at 4GB I'd build images in CI and have Dokploy pull them rather than building
on the server, which is a different — and cheaper — deployment shape.
