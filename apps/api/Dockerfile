# ---------- dependencies ----------
FROM node:22-alpine AS deps
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
# shared must be compiled before the API can import it
RUN pnpm --filter @mapa/shared build \
 && pnpm --filter @mapa/api exec prisma generate \
 && pnpm --filter @mapa/api exec nest build

# ---------- production ----------
FROM node:22-alpine AS production
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=UTC
ENV UPLOAD_DIR=/app/uploads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/uploads

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]