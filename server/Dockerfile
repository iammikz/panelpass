# PanelPass backend — small Express proxy for MangaDex (and future auth/history).
FROM node:20-alpine
WORKDIR /app

# curl is required: it passes Cloudflare from this host where Node-fetch/nginx get challenged.
RUN apk add --no-cache curl

COPY package.json ./
RUN npm install --omit=dev

COPY . .
EXPOSE 8788
CMD ["node", "index.js"]
