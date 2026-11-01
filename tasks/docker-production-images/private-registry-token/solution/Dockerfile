# syntax=docker/dockerfile:1
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# The read:packages token arrives as a BuildKit secret: .npmrc reads it from NPM_TOKEN, which exists
# only while this step runs. Nothing is written to a layer, the image config, its history or the
# provenance attestation (which records build-arg values in plain text in max mode).
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN,required=true \
    npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
USER 1000:1000
EXPOSE 8080
CMD ["node", "src/index.js"]
