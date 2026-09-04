# Sentriroad — single-process container (UI + API in one service)
#
# Build:   docker build -t sentriroad .
# Run:     docker run -p 8080:8080 sentriroad
# Open:    http://localhost:8080   (demo password for all seeded accounts: 123)
#
# Render:  New → Web Service → connect repo → Render auto-detects this
#          Dockerfile → Deploy. Set the service port to 8080.

# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ---- Stage 2: run the API server that also serves the built UI ----
FROM node:20-alpine
WORKDIR /app
ENV PORT=8080
COPY mock-server/package*.json ./
RUN npm install --omit=dev
COPY mock-server/ .
COPY --from=frontend /app/dist ./dist
EXPOSE 8080
CMD ["sh", "-c", "PORT=$PORT STATIC_DIR=/app/dist node server.js"]