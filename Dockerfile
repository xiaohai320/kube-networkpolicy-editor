# Build stage: frontend dist + bundled server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci || npm install
COPY . .
# The server bundle: esbuild keeps the runtime image free of devDependencies.
RUN npm run build && npx esbuild src/server/main.ts --bundle --platform=node --format=cjs --outfile=dist-server/main.cjs

# Runtime: the bundled Hono server serves dist/ and proxies /k8s/*.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist /app/dist
COPY --from=build /app/dist-server /app/dist-server
# undici ships its own ca handling through the bundle; no runtime deps needed.
CMD ["node", "dist-server/main.cjs"]
