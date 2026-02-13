const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

function buildPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('Painel VIP Rust')
    .setDescription('Selecione o servidor e use os botões para vincular Steam ou comprar VIP.')
    .setColor(0xff7a00)
    .addFields(
      { name: 'Servidor', value: 'Escolha Server 1 ou Server 2 no menu abaixo.' },
      { name: 'Ações', value: 'Vincular Steam, Comprar VIP e Comprar VIP+.' }
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

async function ensurePanelMessage(client, channelId, storage) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  const state = storage.getEmbedState();
  const payload = buildPanelPayload();

  if (state.messageId) {
    try {
      const message = await channel.messages.fetch(state.messageId);
      await message.edit(payload);
      return;
    } catch {
      // Recria se apagado ou inacessível
    }
  }

  const created = await channel.send(payload);
  storage.setEmbedState({ messageId: created.id, channelId });
}

module.exports = { buildPanelPayload, ensurePanelMessage };
