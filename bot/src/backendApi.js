const axios = require('axios');

function createBackendApi(config) {
  const http = axios.create({
    baseURL: config.backendUrl,
    timeout: 10000,
    headers: {
      'x-api-key': config.botApiKey
    }
  });

  return {
    async requestSteamLink(discordId, serverId) {
      const response = await http.post('/auth/steam/link', { discordId, serverId });
      return response.data;
    },

    async requestVipCheckout(discordId, serverId, vipType) {
      const response = await http.post('/payments/checkout', { discordId, serverId, vipType });
      return response.data;
    },

    async getPendingEvents() {
      const response = await http.get('/bot/events');
      return response.data?.events || [];
    },

    async ackEvent(eventId) {
      await http.post(`/bot/events/${eventId}/ack`);
    }
  };
}

module.exports = { createBackendApi };
