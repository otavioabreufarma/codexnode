async function sendDmSafe(client, userId, message) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
  } catch (error) {
    console.error(`Falha ao enviar DM para ${userId}:`, error.message);
  }
}

async function handlePaymentConfirmed(member, event, config, client) {
  if (event.vipType === 'vip') {
    await member.roles.add(config.vipRoleId).catch(() => null);
    await member.roles.remove(config.vipPlusRoleId).catch(() => null);
  }

  if (event.vipType === 'vip+') {
    await member.roles.add(config.vipPlusRoleId).catch(() => null);
    await member.roles.remove(config.vipRoleId).catch(() => null);
  }

  await sendDmSafe(
    client,
    event.discordId,
    `✅ Pagamento confirmado no ${event.serverId}. Cargo ${event.vipType.toUpperCase()} aplicado.`
  );
}

async function handleVipExpired(member, event, config, client) {
  await member.roles.remove(config.vipRoleId).catch(() => null);
  await member.roles.remove(config.vipPlusRoleId).catch(() => null);

  await sendDmSafe(
    client,
    event.discordId,
    `⏰ Seu ${event.vipType ? event.vipType.toUpperCase() : 'VIP'} expirou no ${event.serverId}.`
  );
}

async function handleSteamLinked(event, client) {
  await sendDmSafe(client, event.discordId, `✅ Sua Steam foi vinculada com sucesso ao ${event.serverId}.`);
}

async function processEvent(event, client, config, backendApi) {
  if (event.type === 'STEAM_LINKED') {
    await handleSteamLinked(event, client);
    await backendApi.ackEvent(event.eventId);
    return;
  }

  const guild = await client.guilds.fetch(config.guildId);
  const member = await guild.members.fetch(event.discordId).catch(() => null);

  if (!member) {
    await backendApi.ackEvent(event.eventId);
    return;
  }

  if (event.type === 'PAYMENT_CONFIRMED') {
    await handlePaymentConfirmed(member, event, config, client);
  }

  if (event.type === 'VIP_EXPIRED') {
    await handleVipExpired(member, event, config, client);
  }

  await backendApi.ackEvent(event.eventId);
}

function startEventPolling(client, config, backendApi) {
  const poll = async () => {
    try {
      const events = await backendApi.getPendingEvents();
      for (const event of events) {
        await processEvent(event, client, config, backendApi);
      }
    } catch (error) {
      console.error('Erro no polling:', error.response?.data || error.message);
    }
  };

  setInterval(poll, config.pollingIntervalMs);
  return poll;
}

module.exports = { startEventPolling, sendDmSafe };
