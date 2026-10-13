# Build stage: frontend dist + bundled server.
FROM nexus.liangkui.co/docker-group/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Pull deps through the Nexus npm group; the lockfile may carry registry URLs
# unreachable from this network, so resolve from the configured registry.
RUN npm config set registry "http://nexus.liangkui.co/repository/npmjs/" && npm install --no-package-lock
COPY . .
# The server bundle: esbuild keeps the runtime image free of devDependencies.
RUN npm run build && npx esbuild src/server/main.ts --bundle --platform=node --format=cjs --outfile=dist-server/main.cjs

# Runtime: the bundled Hono server serves dist/ and proxies /k8s/*.
FROM nexus.liangkui.co/docker-group/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist /app/dist
COPY --from=build /app/dist-server /app/dist-server
CMD ["node", "dist-server/main.cjs"]
