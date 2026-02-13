const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const requiredEnv = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'CHANNEL_ID',
  'VIP_ROLE_ID',
  'VIP_PLUS_ROLE_ID',
  'BACKEND_URL',
  'BOT_API_KEY'
];

const envCandidatePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env')
];

function hydrateEnvFromKnownPaths() {
  const hasMissing = requiredEnv.some((key) => !process.env[key]);
  if (!hasMissing) {
    return;
  }

  for (const envPath of envCandidatePaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({ path: envPath, override: false });

    const stillMissing = requiredEnv.some((key) => !process.env[key]);
    if (!stillMissing) {
      return;
    }
  }
}

function assertConfig() {
  hydrateEnvFromKnownPaths();

  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }
}

function getConfig() {
  assertConfig();

  const normalizedApiKey = process.env.BOT_API_KEY
    .trim()
    .replace(/^['\"]|['\"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  return {
    discordToken: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    channelId: process.env.CHANNEL_ID,
    vipRoleId: process.env.VIP_ROLE_ID,
    vipPlusRoleId: process.env.VIP_PLUS_ROLE_ID,
    backendUrl: process.env.BACKEND_URL.replace(/\/$/, ''),
    botApiKey: normalizedApiKey,
    pollingIntervalMs: Number(process.env.POLLING_INTERVAL_MS || 15000)
  };
}

module.exports = { getConfig };
