# Holodle — Discord Activity

A Discord Activity port of [Holodle](https://holodle.com)-style daily Hololive
talent guessing, modeled on Discord's official Wordle activity.

- One puzzle per UTC day, shared globally.
- Six guesses per player per day.
- Players in the same voice channel see each other's progress (guess count +
  solved status) but never each other's guesses or the answer.
- Streaks roll over at UTC midnight.

> Fan-made. Not affiliated with Cover Corp.

## Repo layout

```
.
├── packages/
│   ├── shared/          # cross-package TypeScript types
│   ├── client/          # React + Vite + Tailwind SPA (the Activity iframe)
│   └── server/          # Fastify + Socket.IO backend, serves built client
├── talent_data.json     # talent dataset (see schema below) — START EMPTY
├── Dockerfile           # multi-stage; final image runs the server
├── fly.toml             # Fly.io deploy config
└── docker-compose.yml   # local container smoke test
```

## Quickstart

Prereqs: Node 20+, pnpm 9+.

```bash
pnpm install
cp .env.example .env             # fill in DISCORD_CLIENT_ID + SECRET later
pnpm dev                         # server on :3001, client on :5173
```

With an empty `talent_data.json`, the server logs `0 talents loaded` and stays
up. Endpoints respond, but `GET /api/daily` returns 503 until at least one
active talent is added.

> **`.env` lives at the repo root only.** Both the Fastify server (via
> `process.loadEnvFile`) and Vite (via `envDir`) read from
> `holodle/.env`. Do **not** create a separate `packages/client/.env` — the
> client picks up `VITE_DISCORD_CLIENT_ID` from the same file. After editing
> the file, restart `pnpm dev` so Vite re-reads it.

## Debugging the activity in Discord

When the activity is running inside Discord, you can open Chromium devtools
inside the iframe:

- **Desktop Discord:** open the user settings menu → **Advanced** → enable
  *Developer Mode*, then right-click the activity iframe → **Inspect** (or
  press `Ctrl+Shift+I` while the activity is focused).
- The client surfaces specific failure reasons in a red banner — if you see
  one, the matching JS error / network failure will be in the devtools
  Console / Network tabs.

## `talent_data.json` schema

Top-level: an array of talent records. Server validates with Zod at boot and
fails loudly on any malformed entry.

```json
[
  {
    "id": "kobo-kanaeru",
    "name": "Kobo Kanaeru",
    "avatarUrl": "/avatars/kobo-kanaeru.png",
    "branch": "ID",
    "debutYear": 2022,
    "archetype": "Human",
    "heightCm": 152,
    "birthMonth": "December",
    "active": true
  }
]
```

| Field        | Type                                          | Notes |
|--------------|-----------------------------------------------|-------|
| `id`         | string, lowercase-kebab, unique               | Stable key — do not rename. |
| `name`       | string                                        | Display name. |
| `avatarUrl`  | string, usually `/avatars/<id>.png`           | Served statically from `packages/client/public/avatars/`. |
| `branch`     | `"JP" \| "ID" \| "EN" \| "DEV_IS" \| "Stars"` | Hololive branch. |
| `debutYear`  | integer (e.g. 2022)                           | Year of debut. |
| `archetype`  | string                                        | Free-form (Human, Zombie, Phoenix, Shinigami, …). |
| `generation` | string                                        | Free-form (`"Gen 0"`, `"GAMERS"`, `"Promise"`, `"Regloss"`, …). Used as the "Gen" column in the guess grid. |
| `heightCm`   | integer cm                                    | Server derives the bucket: `≤150` Smol, `151–160` Med, `>160` Tall. |
| `birthMonth` | string, English month name                    | "January", "February", …, "December". |
| `active`     | boolean                                       | `false` keeps the talent in autocomplete but excludes from the daily pool. |

Avatar PNGs live at `packages/client/public/avatars/<id>.png`.

## Discord developer portal setup

1. Open https://discord.com/developers/applications and create a new
   application (or use an existing one).
2. **OAuth2** tab — copy the **Client ID** and reset the **Client Secret**.
   Put both into `.env` (the secret is server-only; never expose it to the
   client bundle).
3. **Activities → URL Mappings** — add **one** row only:
   - prefix `/` → target `your-subdomain.trycloudflare.com` (no scheme).

   Do **not** add a separate `/api` mapping. Discord URL Mappings strip the
   prefix before forwarding, so a `/api` row rewrites `/api/talents` to
   `<tunnel>/talents` — the API requests then miss the server's `/api/*`
   routes entirely and fall through to the SPA fallback (HTML for JSON =
   `Unexpected token '<'` in the client). A single `/` mapping preserves
   the full path end-to-end.
4. **Activities → URL Mappings** also requires entries for any external
   hosts your client fetches from (Discord blocks unmapped origins). Add
   `cdn.discordapp.com` if you load Discord avatars; add any other CDN you
   reference.
5. **Bot** tab — required for the per-player and end-of-day recap embeds.
   - **Add Bot** if one doesn't exist, then **Reset Token** and copy the
     bot token into `.env` as `DISCORD_BOT_TOKEN`. The bot token is
     server-only; never expose it to the client bundle.
   - Under **Privileged Gateway Intents**, none are required for posting
     messages — the bot only uses the REST API, never the gateway.
   - **OAuth2 → URL Generator**: tick `bot` under scopes and
     `Send Messages` under bot permissions. Open the generated URL and
     install the bot in the same guild your Activity runs in. The bot
     must have permission to send messages in the channel the Activity
     is launched from, or the embeds will silently fail (the failure is
     logged on the server but doesn't break gameplay).
   - If `DISCORD_BOT_TOKEN` is unset, the server logs a warning at boot
     and both embed types no-op cleanly.

## Running a local dev tunnel

Discord requires HTTPS for the Activity iframe. Two common options:

**cloudflared (recommended, free):**

```bash
cloudflared tunnel --url http://localhost:5173
```

Copy the printed `https://*.trycloudflare.com` URL into the dev portal's
URL Mappings.

**ngrok:**

```bash
ngrok http 5173
```

Same idea — paste the HTTPS URL into the dev portal.

Then in Discord:

1. Join a voice channel in a server where your app is installed.
2. Click the Activities (rocket) icon and pick your app.
3. The iframe loads the tunnel URL; hot-reload works through Vite.

## Production deploy (Fly.io)

```bash
fly launch --no-deploy            # accepts the bundled fly.toml
fly volumes create holodle_data --size 1 --region <your-region>
fly secrets set \
  DISCORD_CLIENT_ID=... \
  DISCORD_CLIENT_SECRET=...
fly deploy
```

The container serves the built client and the API from a single port. SQLite
is persisted to `/data/holodle.db` via the Fly volume mount.

## Scripts

| Command           | Effect                                       |
|-------------------|----------------------------------------------|
| `pnpm dev`        | Run client (Vite) and server (tsx watch).    |
| `pnpm build`      | Build shared → client → server.              |
| `pnpm start`      | Run the built server (serves built client).  |
| `pnpm test`       | Run Vitest across packages.                  |
| `pnpm typecheck`  | `tsc --noEmit` per package.                  |

## Gameplay & comparison rules

See [`packages/server/src/game/compare.ts`](packages/server/src/game/compare.ts).
Every cell is strictly green-equal or red-wrong — no orange "near" states.
Per-attribute summary:

- **Gen / Branch / Archetype** — exact match → green; otherwise red.
- **Debut Year** — exact → green; otherwise red with `↑` (target year is
  higher than your guess) or `↓` (target is lower).
- **Height** — bucketed (`≤150` Smol, `151–160` Med, `>160` Tall). Exact
  bucket → green; otherwise red.
- **Birth Month** — exact → green; otherwise red.

The **answer never reaches the client.** The client renders only the diff
the server returns; Socket.IO broadcasts contain `{userId, guessesUsed,
status}` only — never the guessed talent.

## Time, timezones, and daily rollover

Each player's puzzle rolls over at **their own local midnight**. The
client sends its IANA timezone (from
`Intl.DateTimeFormat().resolvedOptions().timeZone`) on every authenticated
request; the server computes a per-user `dayIndex` against that locale.
Two players in different timezones can be on different puzzles at the
same wall-clock moment — that's intentional.

The end-of-day **recap embed** fires once per day at midnight in
**America/Chicago** (CST/CDT, DST-aware). For each channel that had
players settle a game during the previous 24 hours, the bot posts a
single embed grouping mentions by score. Idempotency is enforced by the
`daily_recaps` SQLite table — the recap can be triggered twice for the
same window without double-posting.

While developing, you can trigger the recap on demand instead of waiting
for midnight:

```bash
curl -X POST http://localhost:3001/api/dev/post-recap \
  -H "Authorization: Bearer dev:anyone"
```

The `/api/dev/*` namespace is registered only when `NODE_ENV !== production`.

## Embed posting (per-player exit + daily recap)

- **Per-player exit embed** posts when a player closes the Activity iframe
  (Socket.IO disconnect), debounced 30 s so a refresh or brief network
  blip doesn't double-post. The embed shows the player's avatar, mention,
  final state (won / lost / partial), and a colored-square grid of their
  guesses. Idempotency: a flag on `user_day.exit_embed_posted` prevents a
  second post for the same player/day.
- **Recap embed** fires at CST midnight per the section above.

Both routes use the same `postChannelMessage` helper which logs and
returns null on Discord-side failures — gameplay never breaks if the
bot can't post.
