const fs = require('fs');
const path = require('path');

const embedStateFile = path.join(__dirname, '..', 'data', 'embed_state.json');
const selectionFile = path.join(__dirname, '..', 'data', 'user_server_selection.json');

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

function getEmbedState() {
  return readJson(embedStateFile, {});
}

function setEmbedState(state) {
  writeJson(embedStateFile, state);
}

function getSelectedServer(userId) {
  const map = readJson(selectionFile, {});
  return map[userId] || null;
}

function setSelectedServer(userId, serverId) {
  const map = readJson(selectionFile, {});
  map[userId] = serverId;
  writeJson(selectionFile, map);
}

module.exports = {
  getEmbedState,
  setEmbedState,
  getSelectedServer,
  setSelectedServer
};
