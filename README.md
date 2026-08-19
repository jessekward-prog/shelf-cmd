# shelf-cmd

Self-hosted bookmark/link manager. Save a URL, it detects the platform (YouTube, TikTok, Spotify, etc.), pulls a thumbnail/embed, and can optionally use a local LLM to write descriptions and turn saved tutorials into step-by-step plans.

## Run it

Requires Docker.

```bash
git clone <this-repo-url>
cd shelf-cmd
docker compose up -d --build
```

Open `http://localhost:3016`. First launch, it'll ask you to **create a PIN** — this is a fresh install, nothing is pre-set, pick your own.

## Optional: AI descriptions and plans

Card descriptions, best-image picking, and the "generate a plan from this video" feature all call an LM Studio-compatible server. Without one configured, the app works fine — those fields just stay blank.

To enable it: run [LM Studio](https://lmstudio.ai) (or any OpenAI-compatible chat server) somewhere reachable from wherever shelf-cmd runs, then create a `.env` file next to `docker-compose.yml`:

```bash
LM_STUDIO_URL=http://<host>:<port>
LM_STUDIO_MODEL=<model-id-as-shown-by-your-server>
LM_STUDIO_API_KEY=<only-if-your-server-requires-one>
```

`docker compose up -d --build` again to pick it up.

## Optional: Twitch embeds

If you'll save Twitch clips and access shelf-cmd at a real domain (not `localhost`), set `TWITCH_PARENT=your-domain.com` in `.env` — Twitch's embed player requires this to match exactly.
