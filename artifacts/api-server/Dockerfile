FROM node:24-slim

WORKDIR /app

# Install dependencies for api-server
COPY artifacts/api-server/package.json artifacts/api-server/pnpm-lock.yaml* ./
RUN corepack enable && pnpm install

# Build the api-server
COPY artifacts/api-server ./artifacts/api-server
RUN cd artifacts/api-server && pnpm run build

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
