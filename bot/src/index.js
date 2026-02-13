require('dotenv').config();

const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const { getConfig } = require('./config');
const storage = require('./storage');
const { createBackendApi } = require('./backendApi');
const { ensurePanelMessage } = require('./panel');
const { startEventPolling, sendDmSafe } = require('./eventsPoller');

const config = getConfig();
const backendApi = createBackendApi(config);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

async function handleButton(interaction) {
  const serverId = storage.getSelectedServer(interaction.user.id);

  if (interaction.customId === 'link_steam') {
    const response = await backendApi.requestSteamLink(interaction.user.id, serverId);
    await sendDmSafe(interaction.client, interaction.user.id, `🔗 Vincule sua Steam aqui: ${response.steamAuthUrl}`);
    await interaction.reply({ content: 'Te enviei o link de vinculação por DM.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'buy_vip' || interaction.customId === 'buy_vip_plus') {
    const vipType = interaction.customId === 'buy_vip' ? 'vip' : 'vip+';
    const response = await backendApi.requestVipCheckout(interaction.user.id, serverId, vipType);
    await sendDmSafe(
      interaction.client,
      interaction.user.id,
      `💳 Finalize a compra (${vipType.toUpperCase()}): ${response.checkoutUrl}`
    );
    await interaction.reply({ content: 'Te enviei o link de pagamento por DM.', flags: MessageFlags.Ephemeral });
  }
}

client.on('clientReady', async () => {
  console.log(`Bot online como ${client.user.tag}`);
  await ensurePanelMessage(client, config.channelId, storage);

  try {
    await backendApi.ping();
    console.log('Conexão bot <-> backend OK.');
  } catch (error) {
    console.error('Falha ao validar conexão com backend:', error.response?.data || error.message);
  }

  const runPollNow = startEventPolling(client, config, backendApi);
  await runPollNow();
});

client.on('messageDelete', async (message) => {
  const state = storage.getEmbedState();
  if (message.id === state.messageId) {
    await ensurePanelMessage(client, config.channelId, storage);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'server_select') {
      const selected = interaction.values[0];
      storage.setSelectedServer(interaction.user.id, selected);
      await interaction.reply({ content: `Servidor selecionado: ${selected}`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error('Erro em interactionCreate:', error.response?.data || error.message);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: 'Ocorreu um erro ao processar sua solicitação.', flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(config.discordToken);
