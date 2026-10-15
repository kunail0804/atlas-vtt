# The campaign container: the relay, the player page, the plugin build the launcher copies into the
# GM's vault, and cloudflared. Build from the repository root:
#   docker build -f selfhost/Dockerfile -t kunail0804/atlas-relay .

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY selfhost/package.json selfhost/package-lock.json selfhost/
RUN cd selfhost && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build:ci && cd selfhost && npx vite build --config player/vite.config.mts

FROM node:24-bookworm-slim AS cloudflared
# Pinned release, checked against the SHA-256 Cloudflare publishes with it. Written as a plain RUN,
# not ADD --checksum, so the check also runs on Docker's classic builder; a mismatch fails the build.
WORKDIR /fetch
RUN node -e ' \
  const { createHash } = require("node:crypto"); \
  const { writeFileSync, chmodSync } = require("node:fs"); \
  const files = [ \
    ["https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-amd64", "cloudflared", "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db"], \
    ["https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.0/LICENSE", "cloudflared-LICENSE", "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd"], \
  ]; \
  (async () => { for (const [url, name, sha] of files) { \
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer()); \
    const got = createHash("sha256").update(bytes).digest("hex"); \
    if (got !== sha) { console.error(name + ": sha256 " + got + " is not " + sha); process.exit(1); } \
    writeFileSync(name, bytes); \
  } chmodSync("cloudflared", 0o755); })(); '

FROM node:24-bookworm-slim
WORKDIR /opt/atlas
# The relay imports the protocol straight from the plugin's sources.
COPY --from=build /src/src/app/online/protocol src/app/online/protocol
COPY --from=build /src/selfhost/package.json selfhost/package.json
COPY --from=build /src/selfhost/node_modules selfhost/node_modules
COPY --from=build /src/selfhost/relay selfhost/relay
COPY --from=build /src/selfhost/player/dist selfhost/player/dist
COPY --from=build /src/dist/main.js /src/dist/styles.css /src/manifest.json plugin/
COPY --from=build /src/LICENSE /src/THIRD_PARTY_NOTICES.md ./
COPY --from=cloudflared /fetch/cloudflared /usr/local/bin/cloudflared
COPY --from=cloudflared /fetch/cloudflared-LICENSE /usr/share/doc/cloudflared/LICENSE
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production \
    RELAY_HOST=0.0.0.0 \
    DATA_DIR=/data \
    IDLE_STOP_MINUTES=5
VOLUME /data
USER node
EXPOSE 8787 8788
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "selfhost/relay/main.ts"]
