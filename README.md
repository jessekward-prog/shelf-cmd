# shelf-cmd

Your own self-hosted shelf for links. Save a URL and it detects the platform
(YouTube, TikTok, Spotify, Instagram, and more), pulls a thumbnail or embed, and
can optionally use a local LLM to write a description or turn a saved tutorial
into a step-by-step plan. Organise cards into **shelves** and **tabs**, store
**files** on each shelf's Drive, and **share a whole shelf** with someone else
who runs their own copy.

Everything lives in your own database on your own machine. Nothing is required
in the cloud — sharing is opt-in and the rest works fully offline.

## Run it

Requires [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/jessekward-prog/shelf-cmd
cd shelf-cmd
docker compose up -d
```

Open **http://localhost:3016**. On first launch it asks you to **create a PIN** —
this is a fresh install, nothing is pre-set, pick your own. That's it; you have a
working shelf.

This pulls a pre-built image and **updates itself** — a small
[Watchtower](https://containrrr.dev/watchtower/) container checks hourly and
restarts `app` when a new version is published, so `git pull` is never needed.
Prefer to build from your own checkout instead (e.g. you're modifying the code)?
Swap `image: ghcr.io/jessekward-prog/shelf-cmd:latest` for `build: .` under
`app` in `docker-compose.yml` and drop the `watchtower` service — see the
"Updating" section below for that path.

To reach it from your phone or another machine, use your host's LAN address
(e.g. `http://192.168.1.20:3016`) or put it behind a reverse proxy / tunnel at a
real domain.

### Set your name

Tap the coloured dot (bottom bar on mobile, top-right on desktop) → **YOU** and
set a username. It's the byline on cards you post, including on shelves you share
into other people's instances, so do this before you share anything.

## The Drive

Every shelf has a **Drive** as well as its cards — flip the `Cards / Drive`
switch at the top of any shelf. Drop files in and each becomes a card with a
thumbnail (a real preview for images), the file size, and a short AI blurb
describing what it is (when AI is enabled). Each file gets a **share link and a
QR code**, so you can hand a file to anyone with a browser.

Files are stored on your own box. With `docker compose` they live on a
persistent `uploads` volume and survive rebuilds. Cap the size with
`MAX_UPLOAD_MB` in `.env` if you want.

## Sharing a shelf

A shelf you share shows up **inside the other person's own shelf-cmd**, sitting
next to their private shelves. You both post into it and it stays in sync both
ways. Neither machine has to be awake for the other's to keep working — shared
shelves ride a small always-online **hub** (see below).

**To share one of your shelves**

1. Hover the shelf in the sidebar (desktop) or its chip in the top strip
   (mobile) and click the **people icon**.
2. You get a **6-digit code**. Send it to whoever you want to add.

**To add a shelf someone shared with you**

1. Click **join with a code** (bottom of the sidebar, or the `+ join` chip on
   mobile).
2. Paste the 6-digit code. Their shelf appears beside your own and syncs both
   ways. They never see the rest of your shelves.

The shelf's owner can rename it, manage its tabs, remove members, rotate the
code, or transfer ownership — even while their machine is off. Members can post,
and edit or delete their own cards; only the owner can moderate everyone's.

### The hub

Sharing needs one always-online middle-man so a shelf can appear on someone
else's box without your machine being awake. That's the hub — it stores small
JSON only: no API keys, no models, no scraping. Instances do the scraping; the
poster's own browser runs the AI on the poster's own account.

- **Do nothing** and shelf-cmd uses a public default hub. Sharing works out of
  the box. Good for trying it out.
- **Run your own hub** for full independence — one small service on Railway (or
  any Docker host). See [shelf-hub](https://github.com/jessekward-prog/shelf-hub);
  then set `HUB_URL=https://your-hub…` in `.env` (below). Everyone sharing a
  given shelf must point at the **same** hub.

To keep an instance fully private with no sharing at all, set `HUB_SYNC=off`.

## Optional settings

Copy `.env.example` to `.env`, uncomment what you want, and run
`docker compose up -d --build` again to apply it. Everything is optional.

### AI descriptions and plans

Card descriptions, best-image picking, and "generate a plan from this video" call
an OpenAI-compatible chat server. Without one, the app works fine — those fields
just stay blank. Run [LM Studio](https://lmstudio.ai) (or similar) somewhere the
app can reach, then set in `.env`:

```bash
LM_STUDIO_URL=http://<host>:<port>
LM_STUDIO_MODEL=<model-id-as-shown-by-your-server>
LM_STUDIO_API_KEY=<only-if-your-server-requires-one>
```

You can also set a **personal** AI endpoint in-app (theme dot → YOU → YOUR AI).
That one runs in your own browser and is used for cards you post into shelves you
don't own — so your key is never sent to anyone else's server.

### Twitch embeds

If you save Twitch clips and reach shelf-cmd at a real domain (not `localhost`),
set `TWITCH_PARENT=your-domain.com` — Twitch's player requires it to match the
address bar exactly.

## Updating

With the default setup (an `image:` for `app`), nothing to do — Watchtower
handles it. If you switched to `build: .`:

```bash
git pull
docker compose up -d --build
```

Your data lives in a Docker volume (`pgdata`) and survives rebuilds. To wipe
everything and start clean, `docker compose down -v`.
