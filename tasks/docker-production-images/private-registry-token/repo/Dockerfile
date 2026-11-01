# syntax=docker/dockerfile:1
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

WORKDIR /app

# read:packages token for the @northwind/* packages on GitHub Packages (see .npmrc)
ARG NPM_TOKEN

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
USER 1000:1000
EXPOSE 8080
CMD ["node", "src/index.js"]
