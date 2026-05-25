#!/usr/bin/env node
// Registers /holodle as a global slash command for the application.
//
// One-shot script: run once after deploy when adding/changing commands.
// Discord docs say global commands propagate to clients within an hour
// (usually faster in practice — minutes). The auto-generated Entry Point
// "Launch" command stays untouched; we add /holodle alongside it.
//
// Required env (the same vars the server reads):
//   DISCORD_CLIENT_ID     — application id
//   DISCORD_BOT_TOKEN     — auth for the commands endpoint (bot token works
//                           even though we don't use a bot user at runtime;
//                           Discord accepts it for application-command CRUD)
//
// Usage:
//   node scripts/register-commands.mjs                 # upsert /holodle
//   node scripts/register-commands.mjs --list          # show current commands
//   node scripts/register-commands.mjs --delete NAME   # remove a command by name

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Lazy .env loader (no dotenv dep). Lines like KEY=VALUE; ignores blanks/#.
function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // No .env file is fine — env may be provided externally.
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, "..", ".env"));

const APP_ID = process.env.DISCORD_CLIENT_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!APP_ID || !TOKEN) {
  console.error("DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN must be set in .env or the environment.");
  process.exit(1);
}

const API = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
const headers = {
  Authorization: `Bot ${TOKEN}`,
  "Content-Type": "application/json",
};

async function listCommands() {
  const resp = await fetch(API, { headers });
  if (!resp.ok) {
    console.error(`GET ${API} → ${resp.status} ${resp.statusText}`);
    console.error(await resp.text());
    process.exit(1);
  }
  return resp.json();
}

async function upsertHolodle() {
  // PUT all commands would clobber the Entry Point "Launch". POST creates
  // or updates by name idempotently (Discord matches by name across calls).
  const body = {
    name: "holodle",
    type: 1, // CHAT_INPUT
    description: "Launch the Holodle activity in this channel",
    dm_permission: false, // makes no sense in DMs (no channel embed target)
    integration_types: [0, 1], // GUILD_INSTALL + USER_INSTALL
    contexts: [0, 1, 2], // GUILD, BOT_DM, PRIVATE_CHANNEL
  };
  const resp = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.error(`POST ${API} → ${resp.status} ${resp.statusText}`);
    console.error(await resp.text());
    process.exit(1);
  }
  return resp.json();
}

async function deleteByName(name) {
  const list = await listCommands();
  const match = list.find((c) => c.name === name);
  if (!match) {
    console.log(`No command named ${name} found.`);
    return;
  }
  const resp = await fetch(`${API}/${match.id}`, { method: "DELETE", headers });
  if (!resp.ok) {
    console.error(`DELETE ${API}/${match.id} → ${resp.status} ${resp.statusText}`);
    console.error(await resp.text());
    process.exit(1);
  }
  console.log(`Deleted ${name} (id ${match.id}).`);
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const list = await listCommands();
  console.log(JSON.stringify(list, null, 2));
} else if (args[0] === "--delete" && args[1]) {
  await deleteByName(args[1]);
} else {
  const result = await upsertHolodle();
  console.log(`Upserted /${result.name} (id ${result.id}). Propagates globally within ~1h.`);
}
