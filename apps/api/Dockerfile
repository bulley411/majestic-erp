FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false

FROM base AS development
COPY . .
RUN pnpm --filter @mapa/api exec prisma generate
EXPOSE 3000
CMD ["pnpm", "--filter", "@mapa/api", "dev"]

FROM base AS build
COPY . .
RUN pnpm --filter @mapa/api exec prisma generate && pnpm --filter @mapa/api build

FROM node:22-alpine AS production
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "dist/main.js"]
