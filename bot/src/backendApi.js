const axios = require('axios');

function createBackendApi(config) {
  const apiKey = config.botApiKey.trim();
  const http = axios.create({
    baseURL: config.backendUrl,
    timeout: 10000,
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`
    }
  });

  return {
    async sendInteraction(payload) {
      const response = await http.post('/bot/interactions', payload);
      return response.data;
    },

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
    },

    async ping() {
      const response = await http.get('/bot/ping');
      return response.data;
    }
  };
}

module.exports = { createBackendApi };
