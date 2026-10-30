# PanelPass backend — small Express proxy for MangaDex (and future auth/history).
FROM node:24-alpine
WORKDIR /app

# curl is required: it passes Cloudflare from this host where Node-fetch/nginx get challenged.
RUN apk add --no-cache curl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY routes ./routes
COPY sources ./sources
EXPOSE 8788
CMD ["node", "index.js"]
