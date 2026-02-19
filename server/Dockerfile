# ─────────────────────────────────────────────────────────────────────────────
# MarLab Backend — Dockerfile
# Targets Linux hosts where Docker can access USB via /dev/bus/usb.
# On Windows, run "node app.js" natively instead (see docker-compose.yml notes).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

# Install Android platform-tools (adb) and utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
      android-sdk-platform-tools \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download scrcpy-server jar
ARG SCRCPY_VERSION=2.7
RUN curl -fL \
      "https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}" \
      -o /app/scrcpy-server.jar

# Copy and install Node dependencies
COPY package.json ./
RUN npm install --omit=dev

COPY app.js ./

EXPOSE 3001

CMD ["node", "app.js"]
