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
// Production env on the Oracle Cloud box lives in ~/envs/holodle.env.sh
// (not in ~/holodle/.env — that's nearly empty). Canonical invocation:
//
//   source ~/envs/holodle.env.sh && node scripts/register-commands.mjs
//
// For local use, fill in .env at the repo root (KEY=VALUE form, no `export`)
// or pass the vars inline on the command line.
//
// Usage:
//   node scripts/register-commands.mjs                 # upsert /holodle (global)
//                                                      #   + /endless and /reset-today
//                                                      #   as guild commands in TEST_GUILD_ID
//   node scripts/register-commands.mjs --list          # show current global commands
//   node scripts/register-commands.mjs --list-guild    # show guild commands in TEST_GUILD_ID
//   node scripts/register-commands.mjs --delete NAME   # remove a global command by name
//   node scripts/register-commands.mjs --delete-guild NAME  # remove a guild command by name

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

// Discord guild whose members get the testing-only commands. Keep this in
// sync with TEST_GUILD_ID in packages/server/src/routes/interactions.ts —
// the server enforces the same id as a defense-in-depth check.
const TEST_GUILD_ID = "1506301114365247611";
const GUILD_API = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${TEST_GUILD_ID}/commands`;

const headers = {
  Authorization: `Bot ${TOKEN}`,
  "Content-Type": "application/json",
};

async function listCommands(api = API) {
  const resp = await fetch(api, { headers });
  if (!resp.ok) {
    console.error(`GET ${api} → ${resp.status} ${resp.statusText}`);
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

async function deleteByName(name, api = API, label = "global") {
  const list = await listCommands(api);
  const match = list.find((c) => c.name === name);
  if (!match) {
    console.log(`No ${label} command named ${name} found.`);
    return;
  }
  const resp = await fetch(`${api}/${match.id}`, { method: "DELETE", headers });
  if (!resp.ok) {
    console.error(`DELETE ${api}/${match.id} → ${resp.status} ${resp.statusText}`);
    console.error(await resp.text());
    process.exit(1);
  }
  console.log(`Deleted ${label} /${name} (id ${match.id}).`);
}

// Test-guild only. Posts /endless and /reset-today to the guild commands
// endpoint, which Discord auto-restricts to TEST_GUILD_ID. Members of
// other guilds won't see these commands at all — they're invisible, not
// just permission-gated.
async function upsertTestGuildCommands() {
  const cmds = [
    {
      name: "endless",
      type: 1,
      description: "(test) Advance to the next talent without waiting for tomorrow",
      dm_permission: false,
    },
    {
      name: "reset-today",
      type: 1,
      description: "(test) Reset today's puzzle progress for every player in the server",
      dm_permission: false,
    },
  ];
  const results = [];
  for (const body of cmds) {
    const resp = await fetch(GUILD_API, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(`POST ${GUILD_API} → ${resp.status} ${resp.statusText}`);
      console.error(await resp.text());
      process.exit(1);
    }
    results.push(await resp.json());
  }
  return results;
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const list = await listCommands(API);
  console.log(JSON.stringify(list, null, 2));
} else if (args.includes("--list-guild")) {
  const list = await listCommands(GUILD_API);
  console.log(JSON.stringify(list, null, 2));
} else if (args[0] === "--delete" && args[1]) {
  await deleteByName(args[1], API, "global");
} else if (args[0] === "--delete-guild" && args[1]) {
  await deleteByName(args[1], GUILD_API, `guild ${TEST_GUILD_ID}`);
} else {
  const result = await upsertHolodle();
  console.log(`Upserted /${result.name} (id ${result.id}). Propagates globally within ~1h.`);
  const guild = await upsertTestGuildCommands();
  for (const cmd of guild) {
    console.log(`Upserted test-guild /${cmd.name} (id ${cmd.id}) in ${TEST_GUILD_ID}.`);
  }
}
