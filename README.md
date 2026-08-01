# Majestic APA ERP

Internal ERP for Majestic APA Limited — HR, payroll, finance and reporting.

```
majestic-erp/
├── apps/
│   ├── api/          NestJS + Prisma + PostgreSQL
│   │   └── prisma/   schema + ledger integrity migrations
│   └── web/          React + Vite + TypeScript
│       └── preview/  static UI preview (open in a browser, no build needed)
├── packages/
│   └── shared/       payroll engine + Zod schemas, used by API and web
├── docker-compose.yml           base stack
├── docker-compose.override.yml  local dev (auto-loaded, publishes ports)
└── docker-compose.prod.yml      VPS (Traefik labels, no published ports)
```

## Local setup

```bash
cp .env.example .env          # then edit
pnpm install
docker compose up -d db redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3000

## Payroll engine

`packages/shared/src/payroll.ts` implements the calculation from your July 2026
sheet. Run the regression suite:

```bash
pnpm --filter @mapa/shared test
```

It asserts against the real figures for MAPA-26-PER-0008 (Aminu Ahmad):
gross 195,000 → basic 78,000, housing 48,750, transport 29,250, utility 19,500,
meal 19,500; pension 8%/10% of BHT 156,000; rent relief 468,000; annual taxable
1,722,240; PAYE 138,336/year.

PAYE uses the **Nigeria Tax Act 2025** bands effective 1 January 2026, which is
what your annual sheet computes. Bands live in the `TaxBand` table keyed by
effective year, so a future rate change is a data change, not a deploy.

### One discrepancy to resolve

Your two workbooks disagree on monthly PAYE for the same employee:

| Source | Monthly PAYE |
|---|---|
| `Majectic_APA_11.xlsx` (annual) | 11,528 |
| July 2026 monthly sheet | 11,128 |

The annual figure is the one the bands reproduce exactly, so the engine returns
11,528. The 400 difference comes out of the rent-relief input. Confirm which
annual rent figure is correct per employee and we'll set `annualRentPaid` on
each record accordingly.

## Ledger

Double-entry, enforced in PostgreSQL rather than application code
(`prisma/migrations/00000000000000_ledger_guards/migration.sql`):

- a line is a debit or a credit, never both, never negative
- posted entries must balance, checked by a deferred constraint trigger
- posted entries and their lines cannot be edited or deleted — correct by reversal
- nothing posts into a closed fiscal period

Payroll runs, vouchers and invoices are subledger documents; each one produces a
journal entry. Reports read from the ledger only.

## Deploying to the VPS

The existing project's Traefik instance handles ingress. This stack joins that
network and publishes no ports of its own.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Before that works, fill these in `.env` on the server:

| Variable | Where to find it |
|---|---|
| `TRAEFIK_NETWORK` | `docker network ls` — the network your Traefik container is attached to |
| `CERT_RESOLVER` | Traefik static config (`traefik.yml` or `--certificatesresolvers.*`) |
| `ENTRYPOINT` | usually `websecure` |
| `APP_DOMAIN` / `API_DOMAIN` | DNS A records pointing at the VPS |

Confirm Traefik's major version too — v2 and v3 differ on router rule syntax.

## Backups

```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backup-$(date +%F).sql.gz"
```

Schedule nightly and copy off the server. Payroll data on a single VPS with no
off-box backup is one disk failure from a very bad month.
