# Deploying to Oracle Cloud (Always Free)

This guide describes how holodle actually runs in production: a native Node
build managed by [pm2](https://pm2.keymetrics.io/) on an Oracle Cloud
Ampere A1 (arm64) instance, fronted by a Cloudflare **Named Tunnel** for
HTTPS.

There is no Docker in the live deploy. The server process (built from
`packages/server`) serves both the API and the pre-built client bundle from
a single port, bound to localhost; cloudflared dials **outbound** to
Cloudflare's edge and forwards public HTTPS traffic to it.

No inbound ports need to be opened on the Oracle VCN / security list — this
is why we use cloudflared rather than Caddy + Let's Encrypt.

> The box also hosts a few sibling bots (`holo-karaoke-bot`, `holoshop_bot`,
> `wkbot`) under the same pm2 instance. Mind the process list when
> restarting — operate on the `holodle` process by name.

---

## Topology at a glance

| Piece            | What it is                                                            |
|------------------|----------------------------------------------------------------------|
| App runtime      | `node packages/server/dist/index.js`, run as pm2 process `holodle`   |
| Repo path        | `/home/ubuntu/holodle`                                                |
| Port             | `PORT` env (e.g. `3011`); defaults to `3001` — see `packages/server/src/env.ts` |
| HTTPS / ingress  | `cloudflared` Named Tunnel, a **systemd** service (`/etc/systemd/system/cloudflared.service`) |
| Public hostname  | Routed by the tunnel to `http://localhost:<PORT>` (e.g. `discord.holodle.win`) |
| Database         | SQLite file at `DB_PATH` (default `./holodle.db` → `/home/ubuntu/holodle/holodle.db`) |
| pm2 resurrection | `pm2-ubuntu.service` (from `pm2 startup`) replays `~/.pm2/dump.pm2` on boot |

---

## 1. Provision the instance

Oracle Cloud → Compute → Instances → Create:

- **Shape**: `VM.Standard.A1.Flex` (Ampere, arm64). 1 OCPU / 6 GB RAM is
  plenty; the app builds and runs comfortably.
- **Image**: Canonical Ubuntu 22.04 (or newer).
- **Networking**: any public subnet. You do **not** need to add an ingress
  rule for 443; cloudflared dials out.
- **SSH key**: paste your public key.

After it boots, SSH in: `ssh ubuntu@<public-ip>`.

## 2. Install the toolchain

```bash
sudo apt-get update
sudo apt-get install -y git
# Node 22 (arm64) — via nvm, fnm, or NodeSource; this box uses Node v22.
# Then pnpm + pm2 globally:
npm i -g pnpm pm2
```

Verify: `node -v` (v22.x), `pnpm -v` (9.x), `pm2 -v`.

## 3. Clone + build

```bash
git clone <your-repo-url> holodle
cd holodle
pnpm install --frozen-lockfile
```

Drop your populated `talent_data.json` in the repo root, then build all
three packages (shared → client → server):

```bash
pnpm build
```

This produces `packages/client/dist` (the static client) and
`packages/server/dist` (the server, which serves that client).

## 4. Configure environment

The server reads its config from environment variables (validated in
`packages/server/src/env.ts`). In this deployment they are baked into the
pm2 process definition rather than a `.env` file (see step 5). The keys:

| Variable                  | Notes                                                        |
|---------------------------|-------------------------------------------------------------|
| `NODE_ENV`                | `production`                                                 |
| `PORT`                    | Local listen port (e.g. `3011`). Must match the tunnel route. |
| `DB_PATH`                 | SQLite path (default `./holodle.db`, relative to the repo).  |
| `DISCORD_CLIENT_ID`       | Discord application (client) id.                             |
| `DISCORD_CLIENT_SECRET`   | OAuth secret for the Activity token exchange.               |
| `DISCORD_PUBLIC_KEY`      | Verifies inbound interaction signatures.                    |
| `DISCORD_BOT_TOKEN`       | Optional; channel embeds no-op without it.                  |
| `CORS_ORIGINS`            | Allowed origins (e.g. `https://discord.com`).               |
| `VITE_DISCORD_CLIENT_ID`  | **Build-time** only — needed by the client build. Kept in a root `.env` so `pnpm build` picks it up. |

> The schema migrations run automatically on server boot — additive
> `ALTER TABLE` columns (see `packages/server/src/db/schema.ts`) are applied
> idempotently, so a `git pull` that adds a pref column needs no manual
> migration step.

## 5. Start under pm2

Start the built server as a named process, passing the runtime env. The
simplest reproducible way is to keep the runtime vars in an env file you
source before starting (do **not** commit it):

```bash
cd /home/ubuntu/holodle
set -a; . ./prod.env; set +a          # your file with NODE_ENV, PORT, DISCORD_*, etc.
pm2 start packages/server/dist/index.js --name holodle
pm2 save                              # persist to ~/.pm2/dump.pm2
pm2 startup systemd                   # one-time: prints a sudo command to enable pm2-ubuntu.service
```

`pm2 save` snapshots the process list **and its environment** into
`~/.pm2/dump.pm2`; `pm2-ubuntu.service` replays it on reboot. After this,
the env lives in the pm2 dump — there is no `.env` read at runtime.

Sanity check:

```bash
pm2 status holodle
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/api/talents   # → 200
```

## 6. HTTPS via a Cloudflare Named Tunnel

A Named Tunnel keeps a stable hostname forever. Requirement: a domain on
Cloudflare DNS.

In the Cloudflare dashboard:

1. Add your domain (Sites → Add a site) and update nameservers at your
   registrar.
2. Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared
   connector). Name it `holodle`. Copy the connector token.
3. On the tunnel's **Public Hostname** tab, add a route:
   - Subdomain: `discord` (or anything)
   - Domain: your zone
   - Service: `http://localhost:<PORT>` (e.g. `http://localhost:3011`)

On the instance, install cloudflared and run it as a systemd service with
the connector token:

```bash
# install the arm64 cloudflared binary to /usr/local/bin, then:
sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<'UNIT'
[Unit]
Description=cloudflared
After=network.target

[Service]
ExecStart=/usr/local/bin/cloudflared --no-autoupdate tunnel run --token <CONNECTOR_TOKEN>
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
systemctl status cloudflared          # Active: running
```

Finally, set the Discord developer portal's **Activities → URL Mappings**
(`/` → your hostname, no scheme — e.g. `discord.holodle.win`). The Activity
now loads from inside Discord over the stable hostname.

## 7. Updates / redeploy

```bash
cd /home/ubuntu/holodle
git pull --ff-only origin master
pnpm install --frozen-lockfile        # only does work if deps changed
pnpm build                            # shared → client → server
pm2 restart holodle                   # picks up the new dist/
```

DB migrations apply on the restart automatically. Verify with the same
`curl .../api/talents` health check, and `pm2 logs holodle --lines 20
--nostream` for the startup banner.

## 8. Backups

SQLite is a single file at `DB_PATH` (`/home/ubuntu/holodle/holodle.db`).
Copying it while the server runs is safe enough for a low-write game, but a
clean snapshot uses SQLite's online backup. A nightly copy to Oracle Object
Storage (Always Free up to 20 GB) is the cheapest option:

```bash
sudo apt-get install -y sqlite3 rclone
# configure rclone with `rclone config` → Oracle Object Storage
echo '0 4 * * * sqlite3 /home/ubuntu/holodle/holodle.db ".backup /tmp/holodle-bak.db" && rclone copy /tmp/holodle-bak.db oracle:holodle-backup/$(date +\%F)/' \
  | crontab -
```

## Appendix: Docker Compose (alternative, not used in production)

The repo still ships a `docker-compose.yml` + `Dockerfile` for a
container-based deploy (the Dockerfile is also what Fly.io uses). It is a
valid alternative, but the live Oracle box runs the pm2 + native-Node setup
documented above, not Compose. If you adopt Compose instead, point the
cloudflared route at the app container's service/port and use
`docker compose build && docker compose up -d` for updates.

## Differences from the Fly.io deploy

| Concern           | Fly.io                       | Oracle Cloud                            |
|-------------------|------------------------------|-----------------------------------------|
| Runtime           | Docker image                 | Native Node under pm2                    |
| HTTPS termination | Fly's edge                   | cloudflared (outbound, no ingress port) |
| Persistent disk   | Fly volume → `/data`         | Plain file on the host disk             |
| Secrets           | `fly secrets set`            | pm2 process env (`pm2 save` dump)       |
| Memory            | 256 MB (tight)               | 6 GB (plenty)                           |
| Architecture      | x86_64                       | arm64                                   |
| Auto-stop         | `auto_stop_machines = stop`  | Always on (Always Free covers 24/7)     |
