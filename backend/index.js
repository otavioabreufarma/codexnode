require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RelyingParty } = require('openid');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const BOT_API_KEY = (process.env.BOT_API_KEY || '').trim();
const PLUGIN_API_TOKEN = process.env.PLUGIN_API_TOKEN || BOT_API_KEY;
const WEBHOOK_SECRET = process.env.INFINITEPAY_WEBHOOK_SECRET || '';
const VIP_PRICE = Number(process.env.VIP_PRICE || 29.9);
const VIP_PLUS_PRICE = Number(process.env.VIP_PLUS_PRICE || 49.9);
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(__dirname, 'events', 'pending_bot_events.json');
const SERVERS = new Set(['server1', 'server2']);

const dbFiles = {
  server1: path.join(DATA_DIR, 'server1.json'),
  server2: path.join(DATA_DIR, 'server2.json')
};

const ordersFile = path.join(DATA_DIR, 'orders.json');
const sessionsFile = path.join(DATA_DIR, 'steam_link_sessions.json');

const relyingParty = new RelyingParty(
  `${BASE_URL}/auth/steam/callback`,
  null,
  true,
  false,
  []
);

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`Erro ao ler JSON ${filePath}:`, error.message);
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function ensureServer(serverId) {
  return SERVERS.has(serverId);
}

function loadServerPlayers(serverId) {
  return readJson(dbFiles[serverId], []);
}

function saveServerPlayers(serverId, players) {
  writeJson(dbFiles[serverId], players);
}

function enqueueEvent(type, payload) {
  const events = readJson(EVENTS_FILE, []);
  const event = {
    eventId: crypto.randomUUID(),
    type,
    discordId: payload.discordId,
    serverId: payload.serverId,
    vipType: payload.vipType || null,
    createdAt: new Date().toISOString(),
    processed: false
  };
  events.push(event);
  writeJson(EVENTS_FILE, events);
  return event;
}

function upsertPlayer(serverId, data) {
  const players = loadServerPlayers(serverId);
  const idx = players.findIndex(
    (p) => p.discordId === data.discordId || (data.steamId && p.steamId === data.steamId)
  );

  if (idx >= 0) {
    players[idx] = { ...players[idx], ...data, serverId };
  } else {
    players.push({
      discordId: data.discordId || null,
      steamId: data.steamId || null,
      serverId,
      vipType: data.vipType || null,
      vipExpiresAt: data.vipExpiresAt || null
    });
  }

  saveServerPlayers(serverId, players);
}

function protectWithApiKey(req, res, next) {
  const apiKeyHeader = req.headers['x-api-key'];
  const authorizationHeader = req.headers.authorization || '';
  const bearerToken = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length)
    : '';
  const apiKey = String(apiKeyHeader || bearerToken || '').trim();

  if (!BOT_API_KEY || apiKey !== BOT_API_KEY.trim()) {
    return res.status(401).json({ error: 'API key inválida.' });
  }
  next();
}

function protectPlugin(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!PLUGIN_API_TOKEN || token !== PLUGIN_API_TOKEN) {
    return res.status(401).json({ error: 'Token do plugin inválido.' });
  }
  next();
}

app.get('/health', (_, res) => {
  res.json({ status: 'ok', host: HOST, port: PORT });
});


function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateInteractionPayload(payload = {}) {
  const { discordId, serverId, type, command } = payload;

  const missing = [];
  if (!isNonEmptyString(discordId)) missing.push('discordId');
  if (!isNonEmptyString(serverId)) missing.push('serverId');
  if (!isNonEmptyString(type)) missing.push('type');
  if (!isNonEmptyString(command)) missing.push('command');

  return {
    discordId,
    serverId,
    type,
    command,
    missing
  };
}
function handleSteamLinkRequest(req, res) {
  const payload = req.method === 'GET' ? req.query : req.body;
  const { discordId, serverId } = payload;
  if (!discordId || !serverId || !ensureServer(serverId)) {
    return res.status(400).json({ error: 'discordId e serverId válidos são obrigatórios.' });
  }

  const sessions = readJson(sessionsFile, []);
  const sessionId = crypto.randomUUID();
  sessions.push({
    sessionId,
    discordId,
    serverId,
    createdAt: new Date().toISOString(),
    used: false
  });
  writeJson(sessionsFile, sessions);

  const returnUrl = `${BASE_URL}/auth/steam/callback?sessionId=${sessionId}`;

  const localRp = new RelyingParty(returnUrl, null, true, false, []);
  localRp.authenticate('https://steamcommunity.com/openid', false, (error, authUrl) => {
    if (error || !authUrl) {
      return res.status(500).json({ error: 'Falha ao gerar link Steam OpenID.' });
    }
    return res.json({ steamAuthUrl: authUrl });
  });
}

app.post('/auth/steam/link', handleSteamLinkRequest);
app.get('/auth/steam/link', handleSteamLinkRequest);

app.get('/auth/steam/callback', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).send('sessionId ausente.');
  }

  relyingParty.verifyAssertion(req, (error, result) => {
    if (error || !result || !result.authenticated) {
      return res.status(401).send('Falha na autenticação OpenID Steam.');
    }

    const steamIdMatch = result.claimedIdentifier && result.claimedIdentifier.match(/\/(\d+)$/);
    const steamId = steamIdMatch ? steamIdMatch[1] : null;

    if (!steamId) {
      return res.status(400).send('Não foi possível extrair SteamID64.');
    }

    const sessions = readJson(sessionsFile, []);
    const idx = sessions.findIndex((s) => s.sessionId === sessionId && !s.used);
    if (idx < 0) {
      return res.status(404).send('Sessão de vinculação inválida ou expirada.');
    }

    const session = sessions[idx];
    sessions[idx].used = true;
    sessions[idx].steamId = steamId;
    writeJson(sessionsFile, sessions);

    upsertPlayer(session.serverId, {
      discordId: session.discordId,
      steamId,
      serverId: session.serverId
    });

    enqueueEvent('STEAM_LINKED', {
      discordId: session.discordId,
      serverId: session.serverId
    });

    return res.send('Steam vinculada com sucesso. Você já pode voltar ao Discord.');
  });
});

async function handleCheckoutRequest(req, res) {
  const requestData = req.method === 'GET' ? req.query : req.body;
  const { discordId, serverId, vipType, redirectUrl } = requestData;
  if (!discordId || !serverId || !ensureServer(serverId)) {
    return res.status(400).json({ error: 'discordId e serverId válidos são obrigatórios.' });
  }

  if (!['vip', 'vip+'].includes(vipType)) {
    return res.status(400).json({ error: 'vipType deve ser vip ou vip+.' });
  }

  const amount = vipType === 'vip' ? VIP_PRICE : VIP_PLUS_PRICE;
  const orderNsu = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const checkoutPayload = {
    amount,
    description: `Rust ${serverId.toUpperCase()} - ${vipType.toUpperCase()}`,
    order_nsu: orderNsu,
    redirect_url: redirectUrl || `${BASE_URL}/payment/success`,
    webhook_url: `${BASE_URL}/webhooks/infinitepay`,
    metadata: {
      discordId,
      serverId,
      vipType
    }
  };

  try {
    const response = await axios.post(
      'https://api.infinitepay.io/invoices/public/checkout/links',
      checkoutPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.INFINITEPAY_HANDLE}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const checkoutUrl = response.data?.url || response.data?.checkout_url || response.data?.data?.url;

    if (!checkoutUrl) {
      return res.status(502).json({ error: 'InfinitePay não retornou URL de checkout.' });
    }

    const orders = readJson(ordersFile, []);
    orders.push({
      order_nsu: orderNsu,
      transaction_nsu: null,
      discordId,
      serverId,
      vipType,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    writeJson(ordersFile, orders);

    return res.json({ checkoutUrl, orderNsu });
  } catch (error) {
    return res.status(502).json({
      error: 'Erro ao criar checkout no InfinitePay.',
      details: error.response?.data || error.message
    });
  }
}

app.post('/payments/checkout', handleCheckoutRequest);
app.get('/payments/checkout', handleCheckoutRequest);

app.post('/webhooks/infinitepay', (req, res) => {
  const token = req.headers['x-webhook-secret'];
  if (WEBHOOK_SECRET && token !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Webhook secret inválido.' });
  }

  const body = req.body || {};
  const orderNsu = body.order_nsu || body.order?.order_nsu;
  const transactionNsu = body.transaction_nsu || body.transaction?.transaction_nsu;
  const status = String(body.status || body.transaction_status || '').toLowerCase();

  if (!orderNsu || !transactionNsu) {
    return res.status(400).json({ error: 'order_nsu e transaction_nsu são obrigatórios.' });
  }

  const orders = readJson(ordersFile, []);
  const idx = orders.findIndex((o) => o.order_nsu === orderNsu);
  if (idx < 0) {
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  }

  orders[idx].transaction_nsu = transactionNsu;
  orders[idx].status = status || 'unknown';
  orders[idx].updatedAt = new Date().toISOString();

  if (status === 'approved' || status === 'paid' || status === 'confirmed') {
    const order = orders[idx];
    const players = loadServerPlayers(order.serverId);
    const pIdx = players.findIndex((p) => p.discordId === order.discordId);
    const now = Date.now();
    const baseExpiration = pIdx >= 0 && players[pIdx].vipExpiresAt ? Date.parse(players[pIdx].vipExpiresAt) : now;
    const nextExpiration = new Date(Math.max(now, baseExpiration) + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (pIdx >= 0) {
      players[pIdx].vipType = order.vipType;
      players[pIdx].vipExpiresAt = nextExpiration;
    } else {
      players.push({
        discordId: order.discordId,
        steamId: null,
        serverId: order.serverId,
        vipType: order.vipType,
        vipExpiresAt: nextExpiration
      });
    }

    saveServerPlayers(order.serverId, players);

    enqueueEvent('PAYMENT_CONFIRMED', {
      discordId: order.discordId,
      serverId: order.serverId,
      vipType: order.vipType
    });
  }

  writeJson(ordersFile, orders);
  return res.json({ ok: true });
});

app.post('/bot/interactions', protectWithApiKey, (req, res) => {
  const { discordId, serverId, type, command, missing } = validateInteractionPayload(req.body);

  if (missing.includes('discordId') || missing.includes('serverId')) {
    return res.status(400).json({ error: 'discordId e serverId válidos são obrigatórios.' });
  }

  if (missing.length) {
    return res.status(400).json({ error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
  }

  return res.json({
    ok: true,
    interaction: {
      discordId,
      serverId,
      type,
      command,
      receivedAt: new Date().toISOString()
    }
  });
});

app.get('/bot/events', protectWithApiKey, (req, res) => {
  const events = readJson(EVENTS_FILE, []);
  const pending = events.filter((e) => !e.processed);
  res.json({ events: pending });
});

app.get('/bot/ping', protectWithApiKey, (_, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post('/bot/events/:eventId/ack', protectWithApiKey, (req, res) => {
  const { eventId } = req.params;
  const events = readJson(EVENTS_FILE, []);
  const idx = events.findIndex((e) => e.eventId === eventId);
  if (idx < 0) return res.status(404).json({ error: 'Evento não encontrado.' });
  events[idx].processed = true;
  events[idx].processedAt = new Date().toISOString();
  writeJson(EVENTS_FILE, events);
  res.json({ ok: true });
});

app.post('/plugin/apply-vip', protectPlugin, (req, res) => {
  const { serverId, steamId, discordId, vipType, vipExpiresAt } = req.body;
  if (!ensureServer(serverId) || !steamId || !['vip', 'vip+'].includes(vipType)) {
    return res.status(400).json({ error: 'Dados inválidos para aplicar VIP.' });
  }

  upsertPlayer(serverId, {
    steamId,
    discordId: discordId || null,
    vipType,
    vipExpiresAt: vipExpiresAt || new Date(Date.now() + 30 * 86400000).toISOString()
  });

  res.json({ ok: true });
});

app.post('/plugin/remove-vip', protectPlugin, (req, res) => {
  const { serverId, steamId } = req.body;
  if (!ensureServer(serverId) || !steamId) {
    return res.status(400).json({ error: 'serverId e steamId são obrigatórios.' });
  }

  const players = loadServerPlayers(serverId);
  const idx = players.findIndex((p) => p.steamId === steamId);
  if (idx < 0) return res.status(404).json({ error: 'Jogador não encontrado.' });

  players[idx].vipType = null;
  players[idx].vipExpiresAt = null;
  saveServerPlayers(serverId, players);

  res.json({ ok: true });
});

app.get('/plugin/vip-status', protectPlugin, (req, res) => {
  const { serverId, steamId } = req.query;
  if (!ensureServer(serverId) || !steamId) {
    return res.status(400).json({ error: 'serverId e steamId são obrigatórios.' });
  }

  const players = loadServerPlayers(serverId);
  const player = players.find((p) => p.steamId === steamId);
  if (!player) return res.json({ hasVip: false, vipType: null, vipExpiresAt: null });

  const hasVip = Boolean(player.vipType && player.vipExpiresAt && Date.parse(player.vipExpiresAt) > Date.now());
  return res.json({
    hasVip,
    vipType: hasVip ? player.vipType : null,
    vipExpiresAt: hasVip ? player.vipExpiresAt : null,
    discordId: player.discordId
  });
});

function processExpiredVips() {
  ['server1', 'server2'].forEach((serverId) => {
    const players = loadServerPlayers(serverId);
    let changed = false;

    players.forEach((player) => {
      if (player.vipType && player.vipExpiresAt && Date.parse(player.vipExpiresAt) <= Date.now()) {
        const expiredVipType = player.vipType;
        player.vipType = null;
        player.vipExpiresAt = null;
        changed = true;

        if (player.discordId) {
          enqueueEvent('VIP_EXPIRED', {
            discordId: player.discordId,
            serverId,
            vipType: expiredVipType
          });
        }
      }
    });

    if (changed) {
      saveServerPlayers(serverId, players);
    }
  });
}

setInterval(processExpiredVips, Number(process.env.VIP_EXPIRY_CHECK_MS || 60000));

app.listen(PORT, HOST, () => {
  console.log(`Backend iniciado em ${HOST}:${PORT}`);
});
