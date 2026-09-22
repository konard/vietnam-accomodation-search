# syntax=docker/dockerfile:1.7

# Both manifests are pinned and publish native linux/amd64 and linux/arm64 images.
FROM rust@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e AS clink
RUN cargo install link-cli --version 0.2.10 --locked

FROM node@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

ARG BUILD_DATE
ARG NPM_PACKAGE_VERSION=0.11.30
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
