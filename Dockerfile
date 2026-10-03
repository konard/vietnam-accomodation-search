# syntax=docker/dockerfile:1.27

# Both manifests are pinned and publish native linux/amd64 and linux/arm64 images:
# rust:1.98.1-trixie and node:24.21.0-trixie-slim (Node.js Active LTS).
FROM rust@sha256:a8a5f0a1e5fe7dfe1d352591e4a1c7dd2c08fd70475cae872cf3458ba0df0546 AS clink
RUN cargo install link-cli --version 0.2.11 --locked

FROM node@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS runtime

ARG BUILD_DATE
ARG NPM_PACKAGE_VERSION
ARG VCS_REF
LABEL org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.description="Browser and Telegram accommodation search for Vietnam" \
      org.opencontainers.image.licenses="Unlicense" \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.source="https://github.com/konard/vietnam-accomodation-search" \
      org.opencontainers.image.title="vietnam-accomodation-search" \
      org.opencontainers.image.version=$NPM_PACKAGE_VERSION

ENV DATA_DIRECTORY=/data \
    HEALTH_HOST=0.0.0.0 \
    HOME=/tmp/home \
    LINKS_BINARY_MIRROR=1 \
    NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const p=require('./package.json'); if (p.version!==process.argv[1] || !/^\\d+\\.\\d+\\.\\d+/.test(process.argv[1] || '') || !/^[a-f0-9]{40}$/.test(process.argv[2] || '') || !Number.isFinite(Date.parse(process.argv[3]))) process.exit(1)" "$NPM_PACKAGE_VERSION" "$VCS_REF" "$BUILD_DATE"
RUN npm ci --omit=dev --ignore-scripts \
    && npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install --no-install-recommends --yes tini \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=clink /usr/local/cargo/bin/clink /usr/local/bin/clink
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node LICENSE README.md ./

RUN mkdir -p /data /tmp/home && chown node:node /data /tmp/home
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "bin/vietnam-accomodation-search.js"]
CMD ["bot"]
