const requiredEnv = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'CHANNEL_ID',
  'VIP_ROLE_ID',
  'VIP_PLUS_ROLE_ID',
  'BACKEND_URL',
  'BOT_API_KEY'
];

function assertConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }
}

function getConfig() {
  assertConfig();

  return {
    discordToken: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    channelId: process.env.CHANNEL_ID,
    vipRoleId: process.env.VIP_ROLE_ID,
    vipPlusRoleId: process.env.VIP_PLUS_ROLE_ID,
    backendUrl: process.env.BACKEND_URL.replace(/\/$/, ''),
    botApiKey: process.env.BOT_API_KEY.trim(),
    pollingIntervalMs: Number(process.env.POLLING_INTERVAL_MS || 15000)
  };
}

module.exports = { getConfig };
