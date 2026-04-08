// Shared store for spawners, chunks, time-series data
// Supports persistence and spawner type tracking

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.resolve(__dirname, '..', 'data');
const SPAWNERS_FILE = path.join(STATE_DIR, 'spawners.json');
const CHUNKS_FILE = path.join(STATE_DIR, 'chunks.json');
const TIMESERIES_FILE = path.join(STATE_DIR, 'timeseries.json');
const BOT_STATE_FILE = path.join(STATE_DIR, 'botStates.json');
const SHOP_MAP_FILE = path.join(STATE_DIR, 'shopMap.json');

const spawners = new Map();
const exploredChunks = new Set();
let loaded = false;

// Time-series: snapshots taken periodically
const timeSeries = []; // { t: timestamp, found, mined, exploredChunks, balance, botsOnline }
const MAX_TIMESERIES = 1440; // 24h at 1min intervals

// --- Persistence ---

function ensureDataDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
  if (loaded) return;
  loaded = true;
  try {
    ensureDataDir();
    if (fs.existsSync(SPAWNERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SPAWNERS_FILE, 'utf-8'));
      if (Array.isArray(data)) for (const s of data) spawners.set(`${s.x},${s.y},${s.z}`, s);
      console.log(`[SpawnerStore] Loaded ${spawners.size} spawners`);
    }
    if (fs.existsSync(CHUNKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string') {
            // Old format: "x,z"
            exploredChunks.add(item);
          } else if (typeof item === 'number') {
            // New packed format: integer
            const x = Math.floor(item / 200000) - 100000;
            const z = (item % 200000) - 100000;
            exploredChunks.add(`${x},${z}`);
          }
        }
      }
      console.log(`[SpawnerStore] Loaded ${exploredChunks.size} chunks`);
    }
    if (fs.existsSync(TIMESERIES_FILE)) {
      const data = JSON.parse(fs.readFileSync(TIMESERIES_FILE, 'utf-8'));
      if (Array.isArray(data)) timeSeries.push(...data.slice(-MAX_TIMESERIES));
      console.log(`[SpawnerStore] Loaded ${timeSeries.length} time-series points`);
    }
  } catch (err) {
    console.error(`[SpawnerStore] Load failed: ${err.message}`);
  }
}

function saveSpawners() {
  try { ensureDataDir(); fs.writeFileSync(SPAWNERS_FILE, JSON.stringify(Array.from(spawners.values()), null, 2)); } catch {}
}

function saveChunks() {
  try {
    ensureDataDir();
    // Pack chunk coords as integers: (chunkX + 100000) * 200000 + (chunkZ + 100000)
    // This is much more compact than JSON string array
    const packed = Array.from(exploredChunks).map(key => {
      const [x, z] = key.split(',').map(Number);
      return (x + 100000) * 200000 + (z + 100000);
    });
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify(packed));
  } catch {}
}

function saveTimeSeries() {
  try { ensureDataDir(); fs.writeFileSync(TIMESERIES_FILE, JSON.stringify(timeSeries.slice(-MAX_TIMESERIES))); } catch {}
}

let saveTimer = null;
function startAutoSave(intervalMs = 60000) {
  if (saveTimer) return;
  saveTimer = setInterval(() => { saveSpawners(); saveChunks(); saveTimeSeries(); }, intervalMs);
}

function stopAutoSave() {
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  saveSpawners(); saveChunks(); saveTimeSeries();
}

// --- Spawners ---

function addSpawner(x, y, z, botIndex, type = 'unknown') {
  loadState();
  const key = `${x},${y},${z}`;
  if (spawners.has(key)) return false;
  spawners.set(key, { x, y, z, type, status: 'found', foundAt: Date.now(), minedAt: null, foundBy: botIndex, minedBy: null });
  return true;
}

function markMined(x, y, z, botIndex) {
  loadState();
  const s = spawners.get(`${x},${y},${z}`);
  if (s) { s.status = 'mined'; s.minedAt = Date.now(); s.minedBy = botIndex; return true; }
  return false;
}

function isKnown(x, y, z) { loadState(); return spawners.has(`${x},${y},${z}`); }

function addExploredChunk(chunkX, chunkZ) { loadState(); exploredChunks.add(`${chunkX},${chunkZ}`); }

// --- Queries ---

function getAllSpawners() { loadState(); return Array.from(spawners.values()); }
function getFoundSpawners() { return getAllSpawners().filter(s => s.status === 'found'); }
function getMinedSpawners() { return getAllSpawners().filter(s => s.status === 'mined'); }

function getSpawnersByType() {
  loadState();
  const byType = {};
  for (const s of spawners.values()) {
    const t = s.type || 'unknown';
    if (!byType[t]) byType[t] = { found: 0, mined: 0, total: 0 };
    byType[t].total++;
    if (s.status === 'mined') byType[t].mined++; else byType[t].found++;
  }
  return byType;
}

function getSpawnersByBot() {
  loadState();
  const byBot = {};
  for (const s of spawners.values()) {
    const bot = s.minedBy ?? s.foundBy;
    if (bot == null) continue;
    if (!byBot[bot]) byBot[bot] = { found: 0, mined: 0 };
    if (s.status === 'mined') byBot[bot].mined++; else byBot[bot].found++;
  }
  return byBot;
}

function getExploredChunks() {
  loadState();
  return Array.from(exploredChunks).map(key => { const [x, z] = key.split(',').map(Number); return { x, z }; });
}

function getStats() {
  loadState();
  let found = 0, mined = 0;
  for (const s of spawners.values()) { if (s.status === 'mined') mined++; else found++; }

  // Efficiency: spawners/hour over last 1h and 24h from time-series
  const now = Date.now();
  const h1 = now - 3600000;
  const h24 = now - 86400000;
  let mined1h = 0, mined24h = 0;
  const recent = timeSeries.filter(p => p.t >= h24);
  if (recent.length >= 2) {
    const pts1h = recent.filter(p => p.t >= h1);
    if (pts1h.length >= 2) mined1h = pts1h[pts1h.length - 1].mined - pts1h[0].mined;
    mined24h = recent[recent.length - 1].mined - recent[0].mined;
  }
  const firstIn1h = recent.find(p => p.t >= h1);
  const elapsed1h = firstIn1h ? Math.min(3600000, now - firstIn1h.t) : 3600000;
  const elapsed24h = Math.min(86400000, recent.length >= 2 ? now - recent[0].t : 86400000);
  const sph1h = elapsed1h > 0 ? (mined1h / (elapsed1h / 3600000)).toFixed(1) : '0.0';
  const sph24h = elapsed24h > 0 ? (mined24h / (elapsed24h / 3600000)).toFixed(1) : '0.0';

  // Per-bot efficiency
  const byBot = getSpawnersByBot();

  return {
    found, mined, total: found + mined, exploredChunks: exploredChunks.size, byType: getSpawnersByType(), byBot,
    efficiency: { sph1h: parseFloat(sph1h), sph24h: parseFloat(sph24h), mined1h, mined24h },
  };
}

// --- Time Series ---

function recordSnapshot(botsOnline = 0, totalBalance = 0) {
  loadState();
  const stats = getStats();
  timeSeries.push({
    t: Date.now(),
    found: stats.found,
    mined: stats.mined,
    exploredChunks: stats.exploredChunks,
    botsOnline,
    totalBalance,
  });
  if (timeSeries.length > MAX_TIMESERIES) timeSeries.splice(0, timeSeries.length - MAX_TIMESERIES);
}

function getTimeSeries() {
  loadState();
  return timeSeries;
}

function exportData() {
  loadState();
  return {
    spawners: Array.from(spawners.values()),
    exploredChunks: Array.from(exploredChunks),
    stats: getStats(),
    timeSeries: timeSeries.slice(-60), // Last 60 points
    exportedAt: new Date().toISOString(),
  };
}

// --- Bot Session State Persistence ---
// Saves explorer direction/distance per bot so they can resume after reconnect

const botStates = new Map();

function saveBotState(botIndex, state) {
  botStates.set(botIndex, { ...state, savedAt: Date.now() });
  try {
    ensureDataDir();
    const data = Object.fromEntries(botStates);
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function loadBotState(botIndex) {
  loadState();
  if (botStates.has(botIndex)) return botStates.get(botIndex);
  // Try loading from disk
  try {
    ensureDataDir();
    if (fs.existsSync(BOT_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOT_STATE_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(data)) botStates.set(parseInt(k), v);
      return botStates.get(botIndex) || null;
    }
  } catch {}
  return null;
}

function clearBotState(botIndex) {
  botStates.delete(botIndex);
  try {
    ensureDataDir();
    const data = Object.fromEntries(botStates);
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// --- Shop Map Persistence ---

function saveShopMap(shopMap) {
  try {
    ensureDataDir();
    fs.writeFileSync(SHOP_MAP_FILE, JSON.stringify({ ...shopMap, savedAt: Date.now() }));
  } catch {}
}

function loadShopMap() {
  try {
    ensureDataDir();
    if (fs.existsSync(SHOP_MAP_FILE)) {
      return JSON.parse(fs.readFileSync(SHOP_MAP_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

module.exports = {
  addSpawner, markMined, isKnown,
  getAllSpawners, getFoundSpawners, getMinedSpawners,
  getSpawnersByType, getSpawnersByBot,
  addExploredChunk, getExploredChunks,
  getStats, exportData,
  recordSnapshot, getTimeSeries,
  loadState, startAutoSave, stopAutoSave, saveSpawners, saveChunks,
  saveBotState, loadBotState, clearBotState,
  saveShopMap, loadShopMap,
};
