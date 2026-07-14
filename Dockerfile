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

# vite.config.ts sets base: '/panelpass/', so output goes to dist/ ready for that path
RUN npm run build

# ---- Runtime stage (static file server, mirrors GitHub Pages) ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html/panelpass
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
