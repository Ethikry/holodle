# Deploying to Oracle Cloud (Always Free)

This guide deploys the same Docker image used elsewhere onto an Oracle Cloud
Ampere A1 (arm64) instance, fronted by a Cloudflare Tunnel for HTTPS.

The compose stack runs two containers:

- `holodle` — the app, bound to `127.0.0.1:3001` only.
- `cloudflared` — Cloudflare Tunnel client, connects **outbound** to
  Cloudflare's edge and forwards public HTTPS traffic to the app over the
  internal compose network.

No inbound ports need to be opened on the Oracle VCN / security list — this
is why we chose cloudflared over Caddy + Let's Encrypt.

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

## 2. Install Docker + compose

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
# log out + back in so the group takes effect
```

Ubuntu's default `iptables` rules drop forwarded traffic, which breaks
container DNS. Either flush them or install `iptables-persistent` with the
Oracle defaults removed:

```bash
sudo iptables -I INPUT 1 -i docker0 -j ACCEPT
sudo iptables -I FORWARD 1 -j ACCEPT
sudo netfilter-persistent save   # if iptables-persistent is installed
```

## 3. Clone + configure

```bash
git clone <your-repo-url> holodle
cd holodle
cp .env.example .env
```

Edit `.env`:

```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...        # optional; embeds no-op without it
CORS_ORIGINS=https://discord.com
# CLOUDFLARED_TOKEN=...      # only for Named Tunnel mode (see step 5)
```

Drop your populated `talent_data.json` in the repo root.

## 4. First build + boot

```bash
docker compose build      # builds arm64 image natively (~3-5 min)
docker compose up -d
docker compose logs -f cloudflared
```

The first time you boot in **Quick Tunnel** mode, cloudflared prints a line
like:

```
INF +--------------------------------------------------------------------------------------------+
INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
INF |  https://something-random-words.trycloudflare.com                                          |
INF +--------------------------------------------------------------------------------------------+
```

Copy that URL into the Discord developer portal's **Activities → URL
Mappings** (`/` → `something-random-words.trycloudflare.com`, no scheme).
The activity should now load from inside Discord.

> ⚠ Quick Tunnel URLs change on every `cloudflared` restart. If you reboot
> the instance or `docker compose restart cloudflared`, you'll get a new URL
> and have to update Discord URL Mappings again. For production use, switch
> to a Named Tunnel (next step).

## 5. (Recommended) Switch to a Named Tunnel for a stable URL

A Named Tunnel keeps the same hostname forever. Requirement: a domain on
Cloudflare DNS (any cheap TLD works — Cloudflare's own registrar sells
several `.com` variants near cost, ~$10/yr).

In the Cloudflare dashboard:

1. Add your domain to Cloudflare (Sites → Add a site) and update the
   nameservers at your registrar.
2. Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared
   connector type). Name it `holodle`. Copy the connector token.
3. On the tunnel's **Public Hostname** tab, add a route:
   - Subdomain: `holodle` (or anything)
   - Domain: your zone
   - Service: `http://holodle:3001` (the compose service name)

Then on the Oracle instance:

```bash
echo 'CLOUDFLARED_TOKEN=<paste token here>' >> .env
```

Edit `docker-compose.yml` — comment out the Quick Tunnel `command:` line
and uncomment the Named Tunnel `command:` + `environment:` block:

```yaml
cloudflared:
  ...
  # command: tunnel --no-autoupdate --url http://holodle:3001
  command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}
  environment:
    TUNNEL_TOKEN: ${CLOUDFLARED_TOKEN:-}
```

Restart:

```bash
docker compose up -d cloudflared
```

Update Discord URL Mappings to your stable hostname (e.g.
`holodle.example.com`). Done — restarts no longer churn the URL.

## 6. Backups

SQLite lives in the `holodle_data` named volume → bind-mounted at `/data`
inside the container. Path on host:

```
/var/lib/docker/volumes/holodle_holodle_data/_data/holodle.db
```

A nightly snapshot to Oracle Object Storage (which is also Always Free up
to 20 GB) is the cheapest backup:

```bash
sudo apt-get install -y rclone
# configure with `rclone config` → Oracle Object Storage
echo '0 4 * * * rclone copy /var/lib/docker/volumes/holodle_holodle_data/_data/ oracle:holodle-backup/$(date +\%F)/' \
  | sudo crontab -
```

## 7. Updates

```bash
git pull
docker compose build
docker compose up -d
```

Compose recreates only changed services. The named volume persists.

## Differences from the Fly.io deploy

| Concern         | Fly.io                       | Oracle Cloud                            |
|-----------------|------------------------------|-----------------------------------------|
| HTTPS termination | Fly's edge                 | cloudflared (outbound, no ingress port) |
| Persistent disk | Fly volume → `/data`         | Docker named volume → `/data`           |
| Secrets         | `fly secrets set`            | `.env` on the host                      |
| Memory          | 256 MB (tight)               | 6 GB (plenty)                           |
| Architecture    | x86_64                       | arm64                                   |
| Auto-stop       | `auto_stop_machines = stop`  | Always on (Always Free covers 24/7)     |
