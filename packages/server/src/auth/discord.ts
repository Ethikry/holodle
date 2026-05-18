import { env } from "../env.js";

// Cache validated access tokens -> Discord user identity. Avoids hitting
// /users/@me on every authenticated request.
interface CachedUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  fetchedAt: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const tokenCache = new Map<string, CachedUser>();

export interface DiscordUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

function avatarUrl(userId: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png`;
}

export async function verifyAccessToken(token: string): Promise<DiscordUser | null> {
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS) {
    return {
      id: cached.id,
      displayName: cached.global_name ?? cached.username,
      avatarUrl: avatarUrl(cached.id, cached.avatar ?? null),
    };
  }

  const resp = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    tokenCache.delete(token);
    return null;
  }
  const user = (await resp.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  const entry: CachedUser = { ...user, fetchedAt: Date.now() };
  tokenCache.set(token, entry);
  return {
    id: user.id,
    displayName: user.global_name ?? user.username,
    avatarUrl: avatarUrl(user.id, user.avatar ?? null),
  };
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export async function exchangeCode(code: string): Promise<OAuthTokenResponse> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    throw new Error("Discord OAuth credentials not configured.");
  }
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
  });
  const resp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord token exchange failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as OAuthTokenResponse;
}
