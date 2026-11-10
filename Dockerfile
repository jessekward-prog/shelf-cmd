FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.60.0-jammy
# "watch" (server/watch.py): yt-dlp to fetch the video, faster-whisper to
# transcribe it. The model is pulled at build time so the first watch isn't a
# 140MB download. Rebuild to pick up a newer yt-dlp when a site breaks it.
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir "yt-dlp[default]" faster-whisper \
 && python3 -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
# The one-off backfills in here are documented as `docker exec <container> node
# scripts/<name>.js`, which only works if they are actually in the image.
COPY scripts/ ./scripts/
COPY --from=build /app/dist ./dist
EXPOSE 3016
CMD ["node", "server/index.js"]
