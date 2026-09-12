# Small, arm64-friendly image: Alpine base, only the two native tools
# (git + ssh) that app deployment actually needs, no build toolchain baked
# into the final layer.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine
RUN apk add --no-cache git openssh-client tini

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# node:22-alpine already ships a "node" user at uid/gid 1000 — reuse it
# rather than creating a second one.
USER node
ENV NODE_ENV=production \
    DATA_DIR=/data \
    SSH_DIR=/keys \
    PORT=3000

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
