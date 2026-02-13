require('dotenv').config();

const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const { getConfig } = require('./config');
const storage = require('./storage');
const { createBackendApi } = require('./backendApi');
const { ensurePanelMessage } = require('./panel');
const { startEventPolling, sendDmSafe } = require('./eventsPoller');

const config = getConfig();
const backendApi = createBackendApi(config);
const VALID_SERVER_IDS = new Set(['server1', 'server2']);

function hasValidInteractionContext(interaction, serverId) {
  const discordId = interaction?.user?.id;
  return Boolean(discordId && serverId && VALID_SERVER_IDS.has(serverId));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

async function handleButton(interaction) {
  const discordId = interaction?.user?.id;
  const serverId = storage.getSelectedServer(interaction.user.id);

  if (!serverId) {
    await interaction.reply({
      content: 'Selecione um servidor no menu antes de continuar.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!VALID_SERVER_IDS.has(serverId)) {
    await interaction.reply({
      content: 'Servidor inválido salvo. Selecione um servidor válido no menu antes de continuar.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!hasValidInteractionContext(interaction, serverId)) {
    await interaction.reply({
      content: 'Não foi possível processar sua solicitação. Verifique seu usuário e servidor selecionado.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === 'link_steam') {
    const response = await backendApi.requestSteamLink(discordId, serverId);
    await sendDmSafe(interaction.client, discordId, `🔗 Vincule sua Steam aqui: ${response.steamAuthUrl}`);
    await interaction.reply({ content: 'Te enviei o link de vinculação por DM.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'buy_vip' || interaction.customId === 'buy_vip_plus') {
    const vipType = interaction.customId === 'buy_vip' ? 'vip' : 'vip+';
    const response = await backendApi.requestVipCheckout(discordId, serverId, vipType);
    await sendDmSafe(
      interaction.client,
      discordId,
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
    const discordId = interaction?.user?.id;
    const serverId = interaction.guildId;
    const type = interaction.isButton()
      ? 'button'
      : interaction.isStringSelectMenu()
        ? 'select_menu'
        : interaction.isChatInputCommand()
          ? 'slash_command'
          : 'other';
    const command = interaction.commandName || interaction.customId || 'unknown';

    if (!serverId) {
      console.warn(`interactionCreate ignorado sem guildId (DM): user=${discordId || 'unknown'} type=${type}`);
      return;
    }

    const interactionPayload = {
      discordId,
      serverId,
      type,
      command
    };

    const missingFields = Object.entries(interactionPayload)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([field]) => field);

    if (missingFields.length) {
      console.error(
        `Payload de interactionCreate inválido. Campos ausentes/vazios: ${missingFields.join(', ')}`,
        interactionPayload
      );
      return;
    }

    await backendApi.sendInteraction(interactionPayload);

    if (interaction.isStringSelectMenu() && interaction.customId === 'server_select') {
      const selected = interaction.values[0];
      if (!VALID_SERVER_IDS.has(selected)) {
        await interaction.reply({
          content: 'Servidor inválido. Selecione uma opção válida no menu.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
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
