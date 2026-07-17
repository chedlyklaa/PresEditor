FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# node:22-alpine ships a non-root `node` user (uid 1000) — the app only
# ever needs to read its own installed files and listen on a port, neither
# of which requires root.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
