FROM node:24-slim

WORKDIR /app

# Install dependencies for decart-camera
COPY artifacts/decart-camera/package.json artifacts/decart-camera/pnpm-lock.yaml* ./
RUN corepack enable && pnpm install

# Build the frontend
COPY artifacts/decart-camera ./artifacts/decart-camera
RUN cd artifacts/decart-camera && pnpm run build

# Expose port
EXPOSE 3000

# Start the frontend server
CMD ["pnpm", "run", "serve", "--", "artifacts/decart-camera"]
