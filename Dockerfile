FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist

# Remote deployment always talks HTTP; PORT is provided by the platform
# (falls back to MCP_PORT, then 8000) — see src/index.ts main().
ENV PORT=8000
EXPOSE 8000

CMD ["node", "dist/index.js"]
