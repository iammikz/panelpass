# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Deterministic install (package-lock.json is committed)
COPY package.json package-lock.json ./
RUN npm ci

# Source (extensions/ submodule, node_modules, dist, docs excluded via .dockerignore)
# Vite reads VITE_* vars from the project-root .env (copied in below) at build time,
# so we do NOT inject them as ARG/ENV here — an empty ENV would shadow the real .env value.
COPY . .

# Optional MangaDex API override for local verification or self-hosting a proxy.
# Defaults to the public API; pass a build-arg to override (e.g. a MangaDex proxy).
ARG VITE_MANGADEX_API_BASE=https://api.mangadex.org
ARG VITE_MANGADEX_COVER_BASE=https://uploads.mangadex.org
ENV VITE_MANGADEX_API_BASE=$VITE_MANGADEX_API_BASE
ENV VITE_MANGADEX_COVER_BASE=$VITE_MANGADEX_COVER_BASE

# vite.config.ts sets base: '/panelpass/', so output goes to dist/ ready for that path
RUN npm run build

# ---- Runtime stage (static file server, mirrors GitHub Pages) ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html/panelpass
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
