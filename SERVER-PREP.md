# Server preparation

Measured: 2 vCPU, 7.8 GB RAM (5.2 GB available), 81 GB free disk, **no swap**.

## 1. Add swap — do this first

You have zero swap. That is the most urgent thing on this box.

Without swap, any memory spike goes straight to the kernel OOM killer,
which does not pick the process that caused the spike — it picks by score,
and long-running memory holders like Postgres or your staging container
are prime targets. A deploy that briefly overshoots can take down the
staging site instead of failing the build.

4 GB of swap on 81 GB of free disk costs you nothing and converts a hard
kill into a slowdown.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Prefer RAM, use swap only under real pressure
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.d/99-swap.conf

free -h   # confirm
```

## 2. Build off the server

2 cores is the binding constraint, not RAM. A pnpm install plus Vite and
Nest builds will saturate both cores for several minutes on every deploy,
and Traefik, Dokploy and the staging site are sharing those same cores.

So: build in GitHub Actions, push to GHCR, have Dokploy pull.

- `.github/workflows/build.yml` builds both images on every push to `main`
- `docker-compose.prod.yml` references `image:` instead of `build:`

Replace `OWNER` in `docker-compose.prod.yml` with your GitHub org or username.

If the repo is private, add the registry credential in Dokploy under
**Settings → Registry** so it can pull.

Deploys become a pull and restart — seconds, and near-zero CPU on the box.

## 3. Memory budget

| | Limit |
|---|---|
| Postgres | 1.0 GB |
| API | 1.0 GB |
| Redis | 256 MB |
| Web (nginx static) | 128 MB |
| **ERP total** | **~2.4 GB** |

Against 5.2 GB available that leaves comfortable headroom for Dokploy and
the staging project. The limits are hard caps, so a runaway query or a
memory leak in the API degrades the ERP and nothing else.

Postgres is tuned down from its defaults in the compose file —
`shared_buffers=384MB`, `max_connections=50`. For 15 employees this is
generous; the defaults assume a dedicated database server.

## 4. When to revisit

At roughly 50 employees, or when payroll runs start taking more than a
few seconds, the first thing to raise is vCPU, not RAM. You have plenty
of memory headroom and very little CPU headroom.
