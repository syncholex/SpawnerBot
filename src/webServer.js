// Web server: Express-based dashboard with SSE real-time updates
// Provides RESTful API for bot control, data export, and monitoring

const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  getAllSpawners, getFoundSpawners, getMinedSpawners, getExploredChunks,
  getStats, getSpawnersByType, getSpawnersByBot, exportData, getTimeSeries,
} = require('./spawnerStore');
const { BotCoordinator } = require('./botCoordinator');
const { loadAccounts } = require('./accountManager');
const { testAllProxies, getProxyHealth, getProxyAssignments } = require('./proxyManager');
const { deepMerge } = require('./shared');

let botStatuses = {};
let logStore = {};
let commandHistory = []; // Track commands sent via web UI
let botControl = null;
let mainLogRef = null;
let sseClients = [];

function setBotStatus(index, status) {
  botStatuses[index] = { ...botStatuses[index], ...status };
  broadcastSSE({ type: 'status', index, data: botStatuses[index] });
}

function addLog(index, level, msg) {
  if (!logStore[index]) logStore[index] = [];
  logStore[index].push({ level, msg, time: new Date().toLocaleTimeString() });
  if (logStore[index].length > 500) logStore[index] = logStore[index].slice(-500);
}

// SSE broadcast - cleans up dead connections
function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const alive = [];
  for (const res of sseClients) {
    try {
      res.write(payload);
      alive.push(res);
    } catch {
      // Connection dead, don't keep it
    }
  }
  sseClients = alive;
}

// Periodic SSE heartbeat to detect dead connections (every 30s)
setInterval(() => {
  if (sseClients.length === 0) return;
  broadcastSSE({ type: 'heartbeat', t: Date.now() });
}, 30000);

function startWebServer(port, mainLog, control) {
  mainLogRef = mainLog;
  if (control) botControl = control;

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Rate limiting
  const rateLimiter = new Map();
  app.use('/api/', (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const last = rateLimiter.get(key) || 0;
    if (now - last < 150) return res.status(429).json({ error: 'Rate limited' });
    rateLimiter.set(key, now);
    if (rateLimiter.size > 10000) { for (const [k, v] of rateLimiter) { if (now - v > 60000) rateLimiter.delete(k); } }
    next();
  });

  // Optional password auth
  function authCheck(req, res, next) {
    const webPassword = botControl?.getConfig()?.webPassword;
    if (!webPassword) return next();
    const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
    if (token === webPassword) return next();
    if (req.method === 'GET' && (req.path === '/sse' || req.path === '/')) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  // --- Health Check ---
  app.get('/api/health', (_req, res) => {
    const bots = Object.keys(botControl?.getInstances?.() || {}).length;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      botsOnline: bots,
      sseClients: sseClients.length,
      memory: { heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB' },
    });
  });

  // --- SSE Endpoint ---
  app.get('/sse', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
  });

  // --- Data APIs ---
  app.get('/api/stats', (_req, res) => res.json(getStats()));
  app.get('/api/spawners', (_req, res) => res.json(getAllSpawners()));
  app.get('/api/spawners/found', (_req, res) => res.json(getFoundSpawners()));
  app.get('/api/spawners/mined', (_req, res) => res.json(getMinedSpawners()));
  app.get('/api/spawners/by-type', (_req, res) => res.json(getSpawnersByType()));
  app.get('/api/spawners/by-bot', (_req, res) => res.json(getSpawnersByBot()));
  app.get('/api/chunks', (_req, res) => res.json(getExploredChunks()));
  app.get('/api/bots', (_req, res) => res.json(botStatuses));
  app.get('/api/timeseries', (_req, res) => res.json(getTimeSeries()));
  app.get('/api/cooldowns', (_req, res) => res.json(BotCoordinator.getCooldowns()));

  // Staff detection status
  app.get('/api/staff', (_req, res) => res.json({
    staffOnline: BotCoordinator.getOnlineStaff(),
    isStaffOnline: BotCoordinator.isStaffOnline(),
  }));

  // Profile endpoint
  app.get('/api/profile', (_req, res) => {
    const profilePath = botControl?.getConfig()?.serverProfile;
    if (!profilePath) return res.json(null);
    try {
      const resolved = path.resolve(__dirname, '..', profilePath);
      const projectRoot = path.resolve(__dirname, '..');
      if (!resolved.startsWith(projectRoot)) return res.status(403).json({ error: 'Invalid path' });
      if (fs.existsSync(resolved)) return res.json(JSON.parse(fs.readFileSync(resolved, 'utf-8')));
    } catch {}
    res.json(null);
  });

  // Shop map endpoint
  app.get('/api/shop-map', (_req, res) => {
    const maps = {};
    for (const [idx, inst] of Object.entries(botControl?.getInstances() || {})) {
      try {
        const map = inst.serverManager?.shopExplorer?.getShopMap();
        if (map) maps[idx] = map;
      } catch {}
    }
    res.json(maps);
  });

  // Host bots endpoint
  app.get('/api/hosts', (_req, res) => {
    const hosts = {};
    for (const [hostIndex, inst] of Object.entries(botControl?.getInstances() || {})) {
      if (!inst.isHost || !inst.hostBot) continue;
      hosts[hostIndex] = inst.hostBot.getStats();
    }
    res.json(hosts);
  });

  // Shop explore trigger
  app.post('/api/bot/:index/explore-shop', authCheck, async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.serverManager?.shopExplorer) return res.json({ ok: false, error: 'No shop explorer' });
    try {
      const map = await inst.serverManager.shopExplorer.explore();
      res.json({ ok: true, categories: Object.keys(map?.categories || {}).length, items: map?.flatItems?.length || 0 });
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.get('/api/bot/:index', (req, res) => res.json(botStatuses[req.params.index] || {}));

  app.get('/api/bot/:index/inventory', (req, res) => {
    const instance = findInstance(parseInt(req.params.index));
    if (!instance?.bot) return res.json([]);
    try {
      const items = instance.bot.inventory.items();
      const totalSlots = 36; // 9 hotbar + 27 inventory
      const usedSlots = items.length;
      res.json({
        items: items.map(item => ({
          name: item.name, displayName: item.displayName || item.name,
          count: item.count, slot: item.slot,
          durability: item.maxDurability ? (item.maxDurability - (item.durabilityUsed || 0)) : null,
          maxDurability: item.maxDurability || null,
        })),
        usedSlots,
        totalSlots,
        inventoryFull: usedSlots >= totalSlots,
      });
    } catch { res.json({ items: [], usedSlots: 0, totalSlots: 36, inventoryFull: false }); }
  });

  // --- Export ---
  app.get('/api/export', (_req, res) => res.json(exportData()));
  app.get('/api/export/csv', (_req, res) => {
    const spawners = getAllSpawners();
    let csv = 'x,y,z,type,status,found_at,mined_at,found_by,mined_by\n';
    for (const s of spawners) csv += `${s.x},${s.y},${s.z},${s.type || 'unknown'},${s.status},${s.foundAt ? new Date(s.foundAt).toISOString() : ''},${s.minedAt ? new Date(s.minedAt).toISOString() : ''},${s.foundBy ?? ''},${s.minedBy ?? ''}\n`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=spawners.csv');
    res.send(csv);
  });

  // --- Bot Control (auth required) ---
  app.use('/api/bot/', authCheck);
  app.use('/api/stop-all', authCheck);
  app.use('/api/config', authCheck);
  app.use('/api/schedules', authCheck);
  app.use('/api/accounts', authCheck);
  app.use('/api/proxies/test', authCheck);

  app.post('/api/bot/start', async (req, res) => {
    if (!botControl) return res.json({ ok: false, error: 'Not initialized' });
    try {
      const { index, username } = req.body || {};
      if (index === undefined) return res.json({ ok: false, error: 'Missing index' });
      res.json(await botControl.startBot(parseInt(index), username));
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/start-all', async (_req, res) => {
    if (!botControl) return res.json({ ok: false, error: 'Not initialized' });
    try {
      const count = botControl.getConfig().botCount || 1;
      const usernames = botControl.generateUsernames(count);
      const results = [];
      for (let i = 0; i < count; i++) {
        const username = botControl.getConfig().authMode === 'offline' ? usernames[i] : undefined;
        results.push(await botControl.startBot(i, username));
        if (i < count - 1) await new Promise(r => setTimeout(r, botControl.getConfig().delays?.botSpawnDelayMs || 5000));
      }
      res.json({ ok: true, results });
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/stop', (req, res) => {
    if (!botControl) return res.json({ ok: false, error: 'Not initialized' });
    res.json(botControl.stopBot(parseInt(req.params.index)));
  });

  app.post('/api/stop-all', (_req, res) => {
    if (!botControl) return res.json({ ok: false, error: 'Not initialized' });
    res.json(botControl.stopAll());
  });

  // Multi-bot actions
  app.post('/api/bots/action', async (req, res) => {
    const { action, indices } = req.body || {};
    if (!action) return res.json({ ok: false, error: 'Missing action' });
    const targetIndices = indices || Object.keys(botControl?.getInstances?.() || {}).map(Number);
    const results = {};
    for (const i of targetIndices) {
      try {
        const inst = findInstance(i);
        if (!inst) continue;
        if (action === 'daily' && inst.serverManager) { await inst.serverManager.claimDaily(); results[i] = 'ok'; }
        else if (action === 'rtp' && inst.serverManager) { await inst.serverManager.rtp(); results[i] = 'ok'; }
        else if (action === 'inventory' && inst.smartInventory) { await inst.smartInventory.manageInventory(); results[i] = 'ok'; }
        else { results[i] = 'skipped'; }
      } catch (err) { results[i] = err.message; }
    }
    res.json({ ok: true, results });
  });

  // --- Bot Actions ---
  app.post('/api/bot/:index/daily', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.serverManager) return res.json({ ok: false, error: 'Bot not found' });
    try { await inst.serverManager.claimDaily(); res.json({ ok: true }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/rtp', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.serverManager) return res.json({ ok: false, error: 'Bot not found' });
    try { await inst.serverManager.rtp(); res.json({ ok: true }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/buy/pickaxe', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.economy) return res.json({ ok: false, error: 'Bot not found' });
    try { res.json({ ok: await inst.economy.buyPickaxe() }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/buy/steak', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.economy) return res.json({ ok: false, error: 'Bot not found' });
    try { res.json({ ok: await inst.economy.buySteak(req.body?.count || 1) }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/buy/totem', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.economy) return res.json({ ok: false, error: 'Bot not found' });
    try { res.json({ ok: await inst.economy.buyTotem() }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/inventory', async (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.smartInventory) return res.json({ ok: false, error: 'Bot not found' });
    try { await inst.smartInventory.manageInventory(); res.json({ ok: true }); } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.post('/api/bot/:index/command', (req, res) => {
    const inst = findInstance(parseInt(req.params.index));
    if (!inst?.bot) return res.json({ ok: false, error: 'Bot not found' });
    const cmd = req.body?.command;
    if (!cmd) return res.json({ ok: false, error: 'No command' });
    inst.bot.chat(cmd);
    // Track command history
    commandHistory.push({ botIndex: parseInt(req.params.index), command: cmd, time: Date.now() });
    if (commandHistory.length > 200) commandHistory.shift();
    res.json({ ok: true });
  });

  // Command history
  app.get('/api/command-history', (_req, res) => res.json(commandHistory.slice(-100)));

  // --- Config & Logs ---
  app.get('/api/config', (_req, res) => { res.json(botControl ? botControl.getConfig() : {}); });

  app.post('/api/config', (req, res) => {
    const configPath = path.join(__dirname, '..', 'config.json');
    try {
      const current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const merged = deepMerge(current, req.body);
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
      // Hot-reload config into running process
      if (botControl?.reloadConfig) botControl.reloadConfig();
      res.json({ ok: true });
      if (mainLogRef) mainLogRef.info('Config updated and hot-reloaded via web UI');
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  app.get('/api/logs/:index', (req, res) => {
    const idx = req.params.index;
    if (idx === 'all') {
      const all = [];
      for (const [i, logs] of Object.entries(logStore)) logs.forEach(l => all.push({ ...l, bot: i }));
      all.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      res.json(all.slice(-300));
    } else { res.json(logStore[idx] || []); }
  });

  app.get('/api/usernames', (req, res) => {
    if (!botControl) return res.json([]);
    res.json(botControl.generateUsernames(parseInt(req.query.count) || 5));
  });

  // --- Metrics API ---
  app.get('/api/metrics', (_req, res) => {
    const m = botControl?.getMetrics();
    if (!m) return res.json({});
    res.json({ perBot: m.getAllMetrics(), leaderboard: m.getLeaderboard(), snapshots: m.getSnapshots().slice(-60) });
  });

  // --- Scheduled Commands API ---
  app.get('/api/schedules', (_req, res) => {
    const sc = botControl?.getScheduledCommands();
    res.json(sc ? { schedules: sc.getSchedules(), log: sc.getExecutionLog() } : { schedules: [], log: [] });
  });

  app.post('/api/schedules', (req, res) => {
    const sc = botControl?.getScheduledCommands();
    if (!sc) return res.json({ ok: false, error: 'Not initialized' });
    const entry = sc.addSchedule(req.body);
    // Persist to config
    persistSchedules(sc);
    res.json({ ok: true, schedule: entry });
  });

  app.delete('/api/schedules/:id', (req, res) => {
    const sc = botControl?.getScheduledCommands();
    if (!sc) return res.json({ ok: false, error: 'Not initialized' });
    const ok = sc.removeSchedule(parseInt(req.params.id));
    if (ok) persistSchedules(sc);
    res.json({ ok });
  });

  app.post('/api/schedules/:id/toggle', (req, res) => {
    const sc = botControl?.getScheduledCommands();
    if (!sc) return res.json({ ok: false, error: 'Not initialized' });
    const result = sc.toggleSchedule(parseInt(req.params.id));
    if (result) persistSchedules(sc);
    res.json(result ? { ok: true, schedule: result } : { ok: false, error: 'Not found' });
  });

  // --- Accounts API ---
  const projectRoot = path.resolve(__dirname, '..');
  app.get('/api/accounts', (_req, res) => {
    const accountsFile = botControl?.getConfig()?.accounts?.file;
    if (!accountsFile) return res.json([]);
    try {
      const resolved = path.resolve(__dirname, '..', accountsFile);
      if (!resolved.startsWith(projectRoot)) return res.status(403).json({ error: 'Invalid path' });
      const data = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      res.json(data.accounts || []);
    } catch { res.json([]); }
  });

  app.post('/api/accounts', (req, res) => {
    const accountsFile = botControl?.getConfig()?.accounts?.file;
    if (!accountsFile) return res.json({ ok: false, error: 'No accounts file configured' });
    try {
      const resolved = path.resolve(__dirname, '..', accountsFile);
      if (!resolved.startsWith(projectRoot)) return res.status(403).json({ error: 'Invalid path' });
      const data = { accounts: req.body };
      fs.writeFileSync(resolved, JSON.stringify(data, null, 2));
      res.json({ ok: true });
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  // --- Proxy API ---
  app.get('/api/proxies/health', (_req, res) => {
    res.json({ health: getProxyHealth(), assignments: getProxyAssignments() });
  });

  app.post('/api/proxies/test', async (_req, res) => {
    const proxies = botControl?.getProxies();
    if (!proxies || !proxies.length) return res.json({ results: [] });
    const results = await testAllProxies(proxies);
    res.json({ results });
  });

  // --- Smart Scheduler API ---
  app.get('/api/scheduler', (_req, res) => {
    const scheduler = botControl?.getSmartScheduler();
    res.json(scheduler ? scheduler.getRiskAssessment() : {});
  });

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.listen(port, () => mainLog.info(`Web dashboard at http://localhost:${port}`));
}

function findInstance(index) {
  if (!botControl) return null;
  return botControl.getInstances()[index] || null;
}

// Persist scheduled commands back to config.json
function persistSchedules(scheduledCommands) {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    current.scheduledCommands = scheduledCommands.getSchedules().map(s => ({
      cron: s.cron,
      command: s.command,
      botIndex: s.botIndex,
      enabled: s.enabled,
      description: s.description,
    }));
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
    if (botControl?.reloadConfig) botControl.reloadConfig();
  } catch (err) {
    if (mainLogRef) mainLogRef.warn(`Failed to persist schedules: ${err.message}`);
  }
}

module.exports = { startWebServer, setBotStatus, addLog, getBotStatuses: () => botStatuses, broadcastSSE };
