# OTEManager — TanStack Start app served by Nitro.
#
# Built on the K3s node (amd64) and imported straight into containerd; nothing
# is pushed to a registry. See Proxmox-Playbook-main/docs/OTEMANAGER.md.
#
# Node 24 is pinned deliberately: .nvmrc says 24, and the project README notes
# the Nitro development adapter drops response headers under Node 26.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Install with dev dependencies — vite/nitro are needed to build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Produces a self-contained bundle in .output (Nitro inlines dependencies),
# so the runtime stage needs no node_modules at all.
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Backup import/export streams large archives through a temp directory.
ENV TMPDIR=/tmp

COPY --from=builder /app/.output ./.output

# Run unprivileged; the node image ships a `node` user.
USER node

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
