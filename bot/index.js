require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers]
});

const BACKEND_URL = process.env.BACKEND_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const VIP_ROLE_ID = process.env.VIP_ROLE_ID;
const VIP_PLUS_ROLE_ID = process.env.VIP_PLUS_ROLE_ID;
const POLLING_INTERVAL_MS = Number(process.env.POLLING_INTERVAL_MS || 15000);

const embedStateFile = path.join(__dirname, 'data', 'embed_state.json');
const selectionFile = path.join(__dirname, 'data', 'user_server_selection.json');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function getServerForUser(userId) {
  const map = readJson(selectionFile, {});
  return map[userId] || 'server1';
}

function setServerForUser(userId, serverId) {
  const map = readJson(selectionFile, {});
  map[userId] = serverId;
  writeJson(selectionFile, map);
}

function buildMessagePayload() {
  const embed = new EmbedBuilder()
    .setTitle('Painel VIP Rust')
    .setDescription('Selecione o servidor e use os botões para vincular Steam ou comprar VIP.')
    .setColor(0xff7a00)
    .addFields(
      { name: 'Servidor', value: 'Escolha Server 1 ou Server 2 no menu abaixo.' },
      { name: 'Fluxo', value: 'Vincular Steam → Comprar VIP/VIP+ → Confirmação automática.' }
    );

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('server_select')
      .setPlaceholder('Selecione o servidor Rust')
      .addOptions(
        { label: 'Rust Server 1', value: 'server1' },
        { label: 'Rust Server 2', value: 'server2' }
      )
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link_steam').setLabel('Vincular Steam').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('buy_vip').setLabel('Comprar VIP').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('buy_vip_plus').setLabel('Comprar VIP+').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [selectRow, buttonRow] };
}

async function ensurePanelMessage() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const state = readJson(embedStateFile, {});
  const payload = buildMessagePayload();

  if (state.messageId) {
    try {
      const msg = await channel.messages.fetch(state.messageId);
      await msg.edit(payload);
      return;
    } catch {
      // recriar se apagado
    }
  }

  const sent = await channel.send(payload);
  writeJson(embedStateFile, { messageId: sent.id, channelId: CHANNEL_ID });
}

async function sendDmSafe(userId, message) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
  } catch (error) {
    console.error(`Falha ao enviar DM para ${userId}:`, error.message);
  }
}

async function handleButton(interaction) {
  const serverId = getServerForUser(interaction.user.id);

  if (interaction.customId === 'link_steam') {
    const response = await axios.post(
      `${BACKEND_URL}/auth/steam/link`,
      { discordId: interaction.user.id, serverId },
      { headers: { 'x-api-key': BOT_API_KEY } }
    );

    await sendDmSafe(interaction.user.id, `🔗 Vincule sua Steam aqui: ${response.data.steamAuthUrl}`);
    await interaction.reply({ content: 'Te enviei o link de vinculação por DM.', ephemeral: true });
  }

  if (interaction.customId === 'buy_vip' || interaction.customId === 'buy_vip_plus') {
    const vipType = interaction.customId === 'buy_vip' ? 'vip' : 'vip+';
    const response = await axios.post(
      `${BACKEND_URL}/payments/checkout`,
      { discordId: interaction.user.id, serverId, vipType },
      { headers: { 'x-api-key': BOT_API_KEY } }
    );

    await sendDmSafe(interaction.user.id, `💳 Finalize a compra (${vipType.toUpperCase()}): ${response.data.checkoutUrl}`);
    await interaction.reply({ content: 'Te enviei o link de pagamento por DM.', ephemeral: true });
  }
}

async function processEvent(event) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(event.discordId).catch(() => null);

  if (!member) {
    await axios.post(
      `${BACKEND_URL}/bot/events/${event.eventId}/ack`,
      {},
      { headers: { 'x-api-key': BOT_API_KEY } }
    );
    return;
  }

  if (event.type === 'PAYMENT_CONFIRMED') {
    if (event.vipType === 'vip') {
      await member.roles.add(VIP_ROLE_ID).catch(() => null);
      await member.roles.remove(VIP_PLUS_ROLE_ID).catch(() => null);
    }

    if (event.vipType === 'vip+') {
      await member.roles.add(VIP_PLUS_ROLE_ID).catch(() => null);
      await member.roles.remove(VIP_ROLE_ID).catch(() => null);
    }

    await sendDmSafe(event.discordId, `✅ Pagamento confirmado no ${event.serverId}. Cargo ${event.vipType.toUpperCase()} aplicado.`);
  }

  if (event.type === 'VIP_EXPIRED') {
    await member.roles.remove(VIP_ROLE_ID).catch(() => null);
    await member.roles.remove(VIP_PLUS_ROLE_ID).catch(() => null);
    await sendDmSafe(event.discordId, `⏰ Seu ${event.vipType ? event.vipType.toUpperCase() : 'VIP'} expirou no ${event.serverId}.`);
  }

  await axios.post(
    `${BACKEND_URL}/bot/events/${event.eventId}/ack`,
    {},
    { headers: { 'x-api-key': BOT_API_KEY } }
  );
}

async function pollEvents() {
  try {
    const response = await axios.get(`${BACKEND_URL}/bot/events`, {
      headers: { 'x-api-key': BOT_API_KEY },
      timeout: 10000
    });

    const events = response.data?.events || [];
    for (const event of events) {
      await processEvent(event);
    }
  } catch (error) {
    console.error('Erro no polling:', error.response?.data || error.message);
  }
}

client.on('ready', async () => {
  console.log(`Bot online como ${client.user.tag}`);
  await ensurePanelMessage();
  setInterval(pollEvents, POLLING_INTERVAL_MS);
});

client.on('messageDelete', async (message) => {
  const state = readJson(embedStateFile, {});
  if (message.id === state.messageId) {
    await ensurePanelMessage();
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'server_select') {
      const selected = interaction.values[0];
      setServerForUser(interaction.user.id, selected);
      await interaction.reply({ content: `Servidor selecionado: ${selected}`, ephemeral: true });
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error('Erro em interactionCreate:', error.response?.data || error.message);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: 'Ocorreu um erro ao processar sua solicitação.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
