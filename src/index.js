const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createLogger, createBotLogger } = require('./logger');
const { loadProxies, getProxy, getHealthyProxy, assignProxy, recordProxySuccess, recordProxyFailure } = require('./proxyManager');
const { getCredentials, generateUsernames } = require('./accountManager');
const { createBot } = require('./bot');
const { SpawnerHunter } = require('./spawnerHunter');
const { ServerManager } = require('./serverManager');
const { HostBot } = require('./hostBot');
const { startWebServer, setBotStatus, addLog, getBotStatuses, broadcastSSE } = require('./webServer');
const { sleep } = require('./utils');
const { deepMerge } = require('./shared');
const { startAutoSave, stopAutoSave, loadState, recordSnapshot } = require('./spawnerStore');
const { BotCoordinator } = require('./botCoordinator');
const { BotMetrics, metrics } = require('./botMetrics');
const { ScheduledCommands } = require('./scheduledCommands');
const { SmartScheduler } = require('./smartScheduler');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');
const DEFAULT_CONFIG = {
  server: { host: 'localhost', port: 25565, version: '1.21.1', password: '', queueTimeoutMs: 300000 },
  botCount: 3,
  autoStart: false,
  authMode: 'offline',
  webPort: 3000,
  webPassword: '',
  serverProfile: 'serverProfiles/default.json',
  spawnerHunting: {
    searchCenterX: 0, searchCenterZ: 0, searchRadius: 2000,
    maxDistanceToSpawner: 128, collectTimeoutMs: 60000, explorationTickMs: 1000,
    maxSpawnerStacksPerBot: 2, cycleOnFull: true,
  },
  delays: { botSpawnDelayMs: 5000, reconnectDelayMs: 30000, maxReconnectDelayMs: 300000 },
  economy: { pickaxeCost: 700, steakCost: 30, totemCost: 2500 },
  shop: { pickaxeSlots: [23, 50, 4, 34], steakSlots: [4, 25, 34], totemSlots: [23, 40, 34], settingsMobSlot: 23, dailyClaimSlot: 1, rtpSlot: 11 },
  survival: { minHealth: 8, minFood: 12, autoEat: true, afkIntervalMs: 240000, stuckThresholdTicks: 30, avoidPlayers: true, playerAvoidRadius: 30, selfDefense: true },
  coordination: { enabled: true, tpaBetweenBots: true },
  maintenance: { restartIntervalHours: 0, pauseHoursStart: -1, pauseHoursEnd: -1, staggerRestartMs: 30000 },
  hostBot: { enabled: false, hunterToHostRatio: 10, storageIntervalMs: 15000, spawnerTransferThreshold: 64 },
  logging: { level: 'info', toFile: true, logDir: './logs' },
  proxies: { file: './proxies.txt' },
  accounts: { file: './accounts.json' },
  webhooks: { discordUrl: '', notifyOnCycle: true, notifyOnDeath: false, notifyOnKick: true },
};

let mainLog, config, proxies = [], serverProfile = null;
let botInstances = {};
let hostBots = {};        // hostIndex -> HostBot instance
let hunterToHost = {};    // hunterIndex -> hostIndex mapping
let reconnectTimers = {};
let reconnectFailures = {};
let shuttingDown = false;
let botSlotCounter = 0;
let scheduledCommands = null;
let smartScheduler = null;

// Death count tracking per bot: botIndex -> array of death timestamps (last 10 min)
const deathCounts = new Map();
const DEATH_WINDOW_MS = 10 * 60 * 1000;
const MAX_DEATHS = 5;

function recordBotDeath(botIndex) {
  const now = Date.now();
  if (!deathCounts.has(botIndex)) deathCounts.set(botIndex, []);
  const deaths = deathCounts.get(botIndex);
  deaths.push(now);
  while (deaths.length > 0 && now - deaths[0] > DEATH_WINDOW_MS) deaths.shift();
  return deaths.length;
}

async function main() {
  config = loadConfig();
  mainLog = createLogger('MCBOT', config.logging.logDir, config.logging.toFile);
  mainLog.info('MCBOT starting...');

  // Load server profile
  serverProfile = loadServerProfile(config.serverProfile);
  if (serverProfile) {
    mainLog.info(`Loaded server profile: ${serverProfile.name || 'unnamed'}`);
  }

  loadState();
  startAutoSave(60000);

  // Initialize scheduled commands
  scheduledCommands = new ScheduledCommands(mainLog);
  if (config.scheduledCommands?.length) {
    for (const sched of config.scheduledCommands) {
      scheduledCommands.addSchedule(sched);
    }
  }
  scheduledCommands.start((command, botIndex) => {
    // Execute scheduled command on matching bots
    const instances = botInstances;
    for (const [idx, inst] of Object.entries(instances)) {
      if (botIndex != null && parseInt(idx) !== botIndex) continue;
      if (!inst.bot) continue;
      try {
        inst.bot.chat(command);
        mainLog.info(`Scheduled: "${command}" sent to Bot-${idx}`);
      } catch {}
    }
  });

  // Initialize smart scheduler
  smartScheduler = new SmartScheduler(config, mainLog);
  smartScheduler.loadState();

  // Metrics snapshot every 5 minutes
  setInterval(() => { metrics.takeSnapshot(); }, 300000);

  // Time-series recording every 60s
  setInterval(() => {
    const botsOnline = Object.keys(botInstances).length;
    const statuses = getBotStatuses();
    const totalBalance = Object.values(statuses).reduce((s, b) => s + (b.balance || 0), 0);
    recordSnapshot(botsOnline, totalBalance);
  }, 60000);

  proxies = loadProxies(path.resolve(__dirname, '..', config.proxies.file));
  mainLog.info(`Loaded ${proxies.length} proxies`);

  // Scheduled maintenance restarts
  const maint = config.maintenance || {};
  if (maint.restartIntervalHours > 0) {
    const intervalMs = maint.restartIntervalHours * 60 * 60 * 1000;
    mainLog.info(`Scheduled restart every ${maint.restartIntervalHours}h`);
    setInterval(() => {
      if (shuttingDown) return;
      mainLog.info('Scheduled maintenance restart starting...');
      const stagger = maint.staggerRestartMs || 30000;
      const indices = Object.keys(botInstances).map(Number);
      indices.forEach((index, i) => {
        setTimeout(() => {
          const inst = botInstances[index];
          if (inst) {
            const savedUsername = inst.creds?.username;
            mainLog.info(`Maintenance restart: Bot-${index}`);
            addLog(index, 'info', 'Scheduled maintenance restart');
            if (reconnectTimers[index]) { clearTimeout(reconnectTimers[index]); delete reconnectTimers[index]; }
            stopBot(index);
            // Restart after a short delay
            setTimeout(() => startBot(index, savedUsername), 10000);
          }
        }, i * stagger);
      });
    }, intervalMs);
  }

  // Pause hours: stop all bots during configured hours (e.g. peak admin time)
  const pauseStart = maint.pauseHoursStart;
  const pauseEnd = maint.pauseHoursEnd;
  if (pauseStart >= 0 && pauseEnd >= 0 && pauseStart !== pauseEnd) {
    let isPaused = false;
    let pausedBotSlots = [];
    mainLog.info(`Pause hours configured: ${pauseStart}:00 - ${pauseEnd}:00`);
    setInterval(() => {
      if (shuttingDown) return;
      const hour = new Date().getHours();
      const shouldBePaused = pauseStart < pauseEnd
        ? (hour >= pauseStart && hour < pauseEnd)
        : (hour >= pauseStart || hour < pauseEnd);

      if (shouldBePaused && !isPaused) {
        mainLog.info(`Pause hours started (${hour}:00) - stopping all bots`);
        isPaused = true;
        // Remember which slots were running so we can restart them
        pausedBotSlots = Object.entries(botInstances).map(([idx, inst]) => ({
          index: parseInt(idx),
          username: inst.creds?.username,
          isHost: inst.isHost || false,
        }));
        for (const slot of pausedBotSlots) {
          addLog(slot.index, 'info', 'Paused for maintenance hours');
        }
        stopAll();
      } else if (!shouldBePaused && isPaused) {
        mainLog.info('Pause hours ended - restarting bots');
        isPaused = false;
        for (const slot of pausedBotSlots) {
          if (slot.isHost) {
            setTimeout(() => startHostBot(slot.index, slot.username), slot.index * (config.delays?.botSpawnDelayMs || 5000));
          } else {
            setTimeout(() => startBot(slot.index, slot.username), slot.index * (config.delays?.botSpawnDelayMs || 5000));
          }
        }
        pausedBotSlots = [];
      }
    }, 60000);
  }

  const botControl = {
    startBot: (index, username) => startBot(index, username),
    stopBot: (index) => stopBot(index),
    stopAll: () => stopAll(),
    getInstances: () => botInstances,
    getConfig: () => config,
    generateUsernames: (count) => generateUsernames(count),
    getProxies: () => proxies,
    reloadConfig: () => reloadConfig(),
    getScheduledCommands: () => scheduledCommands,
    getSmartScheduler: () => smartScheduler,
    getMetrics: () => metrics,
  };

  startWebServer(config.webPort || 3000, mainLog, botControl);
  mainLog.info(`Dashboard at http://localhost:${config.webPort || 3000}`);

  // Assign hunters to host bots
  assignHuntersToHosts(config.botCount || 3);

  // Auto-start bots if configured
  if (config.autoStart) {
    const count = config.botCount || 3;
    const hostCfg = config.hostBot || {};
    const hostCount = hostCfg.enabled ? Math.max(1, Math.ceil(count / (hostCfg.hunterToHostRatio || 10))) : 0;
    const totalBots = count + hostCount;

    mainLog.info(`Auto-starting ${count} hunters + ${hostCount} host bots (${totalBots} total)...`);
    const usernames = generateUsernames(totalBots);

    let slot = 0;
    // Start host bots first (lower indices)
    for (let h = 0; h < hostCount; h++) {
      const username = config.authMode === 'offline' ? usernames[slot] : undefined;
      const hostSlot = slot++;
      setTimeout(() => startHostBot(hostSlot, username), hostSlot * (config.delays?.botSpawnDelayMs || 5000));
    }
    // Start hunter bots
    for (let i = 0; i < count; i++) {
      const username = config.authMode === 'offline' ? usernames[slot] : undefined;
      const hunterSlot = slot++;
      setTimeout(() => startBot(hunterSlot, username), hunterSlot * (config.delays?.botSpawnDelayMs || 5000));
    }
  } else {
    mainLog.info('Ready - start bots from web dashboard');
  }

  process.on('SIGINT', () => gracefulShutdown());
  process.on('SIGTERM', () => gracefulShutdown());
}

// --- Host Bot Assignment ---
function assignHuntersToHosts(hunterCount) {
  const hostCfg = config.hostBot || {};
  if (!hostCfg.enabled) return;

  const hostCount = Math.max(1, Math.ceil(hunterCount / (hostCfg.hunterToHostRatio || 10)));
  hunterToHost = {};

  for (let h = 0; h < hostCount; h++) {
    const hostIndex = `host_${h}`;
    // Assign hunters round-robin to hosts
    for (let i = h; i < hunterCount; i += hostCount) {
      hunterToHost[i] = hostIndex;
    }
  }

  mainLog.info(`Host bot assignment: ${hostCount} hosts for ${hunterCount} hunters`);
  for (const [hunter, host] of Object.entries(hunterToHost)) {
    mainLog.info(`  Hunter-${hunter} -> ${host}`);
  }
}

function getHostForHunter(hunterIndex) {
  return hunterToHost[hunterIndex] || null;
}

function getHostBotInstance(hostIndex) {
  return hostBots[hostIndex] || null;
}

// --- Start Host Bot ---
async function startHostBot(hostSlot, username) {
  if (shuttingDown) return { ok: false, error: 'Shutting down' };
  const hostIndex = `host_${hostSlot}`;  // e.g. "host_0"

  if (botInstances[hostSlot]) return { ok: false, error: `Slot ${hostSlot} already in use` };

  const proxy = getHealthyProxy(proxies, hostSlot);
  if (proxy) assignProxy(hostSlot, proxy);

  const accountsFile = path.resolve(__dirname, '..', config.accounts.file);
  const creds = getCredentials(config.authMode, hostSlot, accountsFile, { [hostSlot]: username });

  const log = createBotLogger(hostSlot, config.logging.logDir, config.logging.toFile);
  log.info(`Starting HOST bot ${creds.username}`);
  addLog(hostSlot, 'info', `Starting HOST ${creds.username}`);
  setBotStatus(String(hostSlot), { username: creds.username, status: 'connecting', position: null, isHost: true });

  try {
    const bot = await createBot({ proxy, server: config.server, credentials: creds, version: config.server.version, log });

    const serverManager = new ServerManager(bot, config, log, serverProfile);
    const instance = { bot, serverManager, log, index: hostSlot, creds, isHost: true, economy: null, smartInventory: null, hostBot: null, statusInterval: null, spawnTime: null, cleanedUp: false };
    botInstances[hostSlot] = instance;

    bot.once('spawn', () => {
      BotCoordinator.registerBotUsername(creds.username);
      instance.spawnTime = Date.now();
      recordProxySuccess(proxy);
      reconnectFailures[hostSlot] = 0;
      metrics.init(hostSlot);
      log.info('HOST spawned - initializing');
      addLog(hostSlot, 'info', 'HOST spawned');

      serverManager.initialize()
        .then(({ economy, smartInventory }) => {
          instance.economy = economy;
          instance.smartInventory = smartInventory;

          // Create and start the host bot logic
          const hostBot = new HostBot(bot, config, log, hostIndex, economy, smartInventory);
          instance.hostBot = hostBot;
          hostBots[hostIndex] = hostBot;
          hostBot.start();

          setBotStatus(String(hostSlot), {
            username: creds.username, status: 'hosting', position: null,
            isHost: true, hostStats: hostBot.getStats(),
          });
          addLog(hostSlot, 'info', 'HOST ready - collecting spawners');
        })
        .catch((err) => {
          log.error(`HOST init failed: ${err.message}`);
          addLog(hostSlot, 'error', `HOST init failed: ${err.message}`);
          scheduleReconnect(hostSlot, creds.username);
        });
    });

    // Status interval for host bot
    instance.statusInterval = setInterval(() => {
      if (!botInstances[hostSlot]) { clearInterval(instance.statusInterval); return; }
      try {
        const pos = bot.entity?.position;
        const balance = instance.economy?.balance || 0;
        const hostStats = instance.hostBot?.getStats() || {};
        setBotStatus(String(hostSlot), {
          username: creds.username,
          status: 'hosting',
          position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
          balance,
          isHost: true,
          hostStats,
          uptime: instance.spawnTime ? Math.floor((Date.now() - instance.spawnTime) / 1000) : 0,
        });
      } catch {}
    }, 5000);

    // Reuse same event handlers as hunter bots
    bot.on('death', () => {
      log.warn('HOST died - respawning...');
      addLog(hostSlot, 'warn', 'HOST died');
      setTimeout(() => { try { bot.respawn(); } catch {} }, 2000);
      bot.once('spawn', async () => {
        log.info('HOST respawned');
        try { if (instance.serverManager) await instance.serverManager.goHome(); } catch {}
      });
    });

    bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'string' ? reason : (reason?.toString?.() || JSON.stringify(reason));
      log.warn(`HOST kicked: ${reasonStr}`);
      addLog(hostSlot, 'warn', `HOST kicked: ${reasonStr}`);
      recordProxyFailure(proxy);
      clearInterval(instance.statusInterval);
      cleanupBot(hostSlot);
      scheduleReconnect(hostSlot, creds.username);
    });

    bot.on('error', (err) => {
      log.error(`HOST error: ${err.message}`);
      addLog(hostSlot, 'error', `HOST error: ${err.message}`);
    });

    bot.on('message', (jsonMsg) => {
      try {
        const text = jsonMsg.toString();
        if (text.trim().length === 0) return;
        broadcastSSE({ type: 'chat', botIndex: hostSlot, username: creds.username, text });
      } catch {}
    });

    bot.on('end', (reason) => {
      if (shuttingDown) return;
      log.warn(`HOST disconnected: ${reason}`);
      clearInterval(instance.statusInterval);
      cleanupBot(hostSlot);
      scheduleReconnect(hostSlot, creds.username);
    });

    return { ok: true, username: creds.username };
  } catch (err) {
    log.error(`Failed to create HOST: ${err.message}`);
    scheduleReconnect(hostSlot, creds.username);
    return { ok: false, error: err.message };
  }
}

async function startBot(index, username) {
  if (shuttingDown) return { ok: false, error: 'Shutting down' };
  if (botInstances[index]) return { ok: false, error: `Bot ${index} already running` };

  if (reconnectTimers[index]) { clearTimeout(reconnectTimers[index]); delete reconnectTimers[index]; }

  const proxy = getHealthyProxy(proxies, index);
  if (proxy) assignProxy(index, proxy);
  const accountsFile = path.resolve(__dirname, '..', config.accounts.file);
  const customNames = username ? { [index]: username } : null;
  const creds = getCredentials(config.authMode, index, accountsFile, customNames);

  // Per-bot config overrides
  const botConfig = getBotConfig(index);

  botSlotCounter = Math.max(botSlotCounter, index + 1);

  const log = createBotLogger(index, config.logging.logDir, config.logging.toFile);
  log.info(`Starting bot ${creds.username}`);
  addLog(index, 'info', `Starting ${creds.username}`);
  setBotStatus(String(index), { username: creds.username, status: 'connecting', position: null, stats: { found: 0, collected: 0, failed: 0 } });

  try {
    const bot = await createBot({ proxy, server: botConfig.server, credentials: creds, version: botConfig.server.version, log });

    const serverManager = new ServerManager(bot, botConfig, log, serverProfile);
    const hunter = new SpawnerHunter(bot, botConfig, index, config.botCount, log);
    const instance = { bot, hunter, serverManager, log, index, creds, economy: null, smartInventory: null, statusInterval: null, spawnTime: null, cleanedUp: false };
    botInstances[index] = instance;

    bot.once('spawn', () => {
      BotCoordinator.registerBotUsername(creds.username);
      instance.spawnTime = Date.now();
      recordProxySuccess(proxy);
      reconnectFailures[index] = 0; // Reset backoff on successful connection
      metrics.init(index);
      log.info('Spawned - starting server init');
      addLog(index, 'info', 'Spawned in world');
      setBotStatus(String(index), { username: creds.username, status: 'initializing', position: null, stats: hunter.getStats() });

      serverManager.initialize()
        .then(({ economy, smartInventory }) => {
          instance.economy = economy;
          instance.smartInventory = smartInventory;
          hunter.setDependencies(smartInventory, economy);
          hunter._serverManager = serverManager; // Give hunter access to serverManager

          // Wire AntiDetection: create and start, pass to hunter
          try {
            const { AntiDetection } = require('./antiDetection');
            const antiDetection = new AntiDetection(bot, log, config);
            antiDetection.start();
            hunter._antiDetection = antiDetection;
          } catch (err) {
            log.warn(`AntiDetection not available: ${err.message}`);
          }

          // Wire SmartScheduler: apply adjusted params to hunter if scheduler is active
          if (smartScheduler) {
            try {
              const adjustedParams = smartScheduler.getAdjustedParams();
              hunter._scheduler = smartScheduler;
              // Apply scheduling adjustments to config overrides for this hunter
              if (adjustedParams.skipNonEssential) {
                hunter._skipNonEssential = true;
              }
            } catch {}
          }

          // Wire ItemLending for inter-bot item sharing
          // (Actual lending listener is in SpawnerHunter._setupLendingListener via botEvents)
          try {
            const { ItemLending } = require('./itemLending');
            hunter._itemLending = new ItemLending(bot, config, log, index);
          } catch {}

          // Provide hunter access to all bot instances for item lending lookups
          hunter._botInstances = botInstances;

          // Set up host bot transfer function for this hunter
          const hostIndex = getHostForHunter(index);
          if (hostIndex && config.hostBot?.enabled) {
            hunter._hostTransferFn = async (count) => {
              const hostInst = getHostBotInstance(hostIndex);
              if (!hostInst) throw new Error('Host bot not available');
              const hostName = hostInst.getUsername();
              log.info(`Transferring ${count} spawners to host ${hostName}`);
              const { ItemTransfer } = require('./itemTransfer');
              const transfer = new ItemTransfer(bot, config, log, index);
              try { await serverManager.goHome(); await sleep(2000); } catch {}
              const success = await transfer.transferToBot(null, hostName, ['spawner']);
              if (!success) throw new Error('Transfer failed');
            };
          }
          setBotStatus(String(index), { username: creds.username, status: 'hunting', position: null, stats: hunter.getStats() });
          addLog(index, 'info', 'Server init complete, hunting started');

          hunter.start().then(async () => {
            if (hunter.shouldCycle && config.spawnerHunting?.cycleOnFull) {
              log.info('Bot cycled out - spawner capacity full');
              addLog(index, 'info', 'Cycled out - spawner capacity full');
              sendWebhook('cycle', `Bot-${index} (${creds.username}) cycled out - spawner capacity reached`);

              // Try to transfer spawners to an active bot before cycling
              try {
                const spawnerCount = hunter.getStats().spawnerCount || 0;
                if (spawnerCount > 0) {
                  const { ItemTransfer } = require('./itemTransfer');
                  const transfer = new ItemTransfer(bot, config, log, index);
                  // Go home first (known safe spot)
                  await serverManager.goHome();
                  await sleep(2000);
                  // Try to find an active bot to transfer to
                  const positions = BotCoordinator.getBotPositions();
                  for (const [idx, pos] of positions) {
                    const targetIdx = parseInt(idx);
                    if (targetIdx === index) continue;
                    if (Date.now() - pos.timestamp > 60000) continue; // Skip stale
                    const targetInst = botInstances[targetIdx];
                    if (!targetInst) continue;
                    const targetName = targetInst.creds?.username;
                    if (!targetName) continue;
                    log.info(`Attempting spawner transfer to ${targetName} (Bot-${targetIdx})`);
                    const success = await transfer.transferToBot(targetIdx, targetName, ['spawner']);
                    if (success) {
                      log.info(`Transferred spawners to Bot-${targetIdx}`);
                      break;
                    }
                  }
                }
              } catch (err) {
                log.warn(`Spawner transfer failed: ${err.message}`);
              }

              cleanupBot(index);
              setBotStatus(String(index), { username: creds.username, status: 'cycled', position: null, stats: hunter.getStats() });
              const newIndex = botSlotCounter++;
              const newName = config.authMode === 'offline' ? generateUsernames(1)[0] : undefined;
              mainLog.info(`Starting replacement bot-${newIndex}`);
              startBot(newIndex, newName);
            }
          }).catch((err) => {
            log.error(`Hunter crashed: ${err.message}`);
            addLog(index, 'error', `Hunter crash: ${err.message}`);
          });
        })
        .catch((err) => {
          log.error(`Server init failed: ${err.message}`);
          addLog(index, 'error', `Init failed: ${err.message}`);
          scheduleReconnect(index, creds.username);
        });
    });

    // Periodic status update
    instance.statusInterval = setInterval(() => {
      if (!botInstances[index]) { clearInterval(instance.statusInterval); return; }
      try {
        const pos = bot.entity?.position;
        const stats = hunter.getStats();
        const balance = instance.economy?.balance || 0;
        const healthData = hunter.survival?.getHealthData() || {};

        // Track position trail (last 100 positions)
        const trailKey = String(index);
        const existing = getBotStatuses()[trailKey] || {};
        const trail = existing.trail || [];
        if (pos) {
          const p = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), t: Date.now() };
          trail.push(p);
          if (trail.length > 100) trail.shift();
        }

        setBotStatus(String(index), {
          username: creds.username,
          status: hunter.running ? 'hunting' : (botInstances[index] ? 'idle' : 'disconnected'),
          position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
          balance,
          stats,
          spawnerCount: stats.spawnerCount || 0,
          health: healthData.health,
          food: healthData.food,
          xp: healthData.xp,
          xpLevel: healthData.xpLevel,
          uptime: instance.spawnTime ? Math.floor((Date.now() - instance.spawnTime) / 1000) : 0,
          trail,
          inventoryFull: hunter.isInventoryFull?.() || false,
        });
      } catch {}
    }, 5000);

    bot.on('death', () => {
      log.warn('Bot died - respawning...');
      addLog(index, 'warn', 'Bot died');
      metrics.recordDeath(index);
      const recentDeaths = recordBotDeath(index);
      setBotStatus(String(index), { username: creds.username, status: 'dead', position: null, stats: hunter.getStats() });
      sendWebhook('death', `Bot-${index} (${creds.username}) died`);

      // Check death count limit: stop bot if too many deaths in the last 10 minutes
      if (recentDeaths > MAX_DEATHS) {
        log.error(`Bot-${index} exceeded death limit (${recentDeaths} deaths in 10 min) - stopping`);
        addLog(index, 'error', `Death limit exceeded (${recentDeaths} in 10 min) - stopping bot`);
        clearInterval(instance.statusInterval);
        cleanupBot(index);
        return;
      }

      // Respawn after short delay
      setTimeout(() => {
        try { bot.respawn(); } catch (e) { log.error(`Respawn failed: ${e.message}`); }
      }, 2000);

      // Recovery after respawn
      bot.once('spawn', async () => {
        log.info('Respawned - running recovery');
        addLog(index, 'info', 'Respawned');
        try {
          if (instance.serverManager) await instance.serverManager.runDeathRecovery();
          if (instance.smartInventory) await instance.smartInventory.manageInventory();
          if (instance.economy) await instance.economy.refreshBalance();
        } catch {}
      });
    });

    bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'string' ? reason : (reason?.toString?.() || JSON.stringify(reason));
      log.warn(`Kicked: ${reasonStr}`);
      addLog(index, 'warn', `Kicked: ${reasonStr}`);
      recordProxyFailure(proxy);
      setBotStatus(String(index), { username: creds.username, status: 'kicked', position: null, stats: hunter.getStats() });
      clearInterval(instance.statusInterval);
      cleanupBot(index);
      sendWebhook('kick', `Bot-${index} (${creds.username}) kicked: ${reasonStr}`);

      // Parse disconnect reason
      const parsed = parseKickReason(reason);
      if (parsed.isBanned) {
        log.error(`Bot-${index} was banned! Not reconnecting.`);
        addLog(index, 'error', 'Banned - not reconnecting');
        return;
      }
      if (parsed.isRestart) {
        log.info(`Server restart detected - reconnecting sooner`);
        scheduleReconnect(index, creds.username, 10000);
      } else {
        scheduleReconnect(index, creds.username);
      }
    });

    bot.on('error', (err) => {
      log.error(`Bot error: ${err.message}`);
      addLog(index, 'error', `Error: ${err.message}`);
    });

    // Relay server chat to dashboard via SSE
    bot.on('message', (jsonMsg) => {
      try {
        const text = jsonMsg.toString();
        // Filter out system messages that are just formatting
        if (text.trim().length === 0) return;
        broadcastSSE({ type: 'chat', botIndex: index, username: creds.username, text });
      } catch {}
    });

    bot.on('end', (reason) => {
      if (shuttingDown) return;
      log.warn(`Disconnected: ${reason}`);
      addLog(index, 'warn', `Disconnected: ${reason}`);
      const isPlayerAvoidance = reason === 'Player avoidance';
      const status = isPlayerAvoidance ? 'avoiding_players' : 'disconnected';
      setBotStatus(String(index), { username: creds.username, status, position: null, stats: hunter.getStats() });
      clearInterval(instance.statusInterval);
      cleanupBot(index);
      // Player avoidance: reconnect after 2 hours instead of default delay
      const reconnectDelay = isPlayerAvoidance ? 2 * 60 * 60 * 1000 : undefined;
      scheduleReconnect(index, creds.username, reconnectDelay);
    });

    return { ok: true, username: creds.username };
  } catch (err) {
    log.error(`Failed to create bot: ${err.message}`);
    addLog(index, 'error', `Create failed: ${err.message}`);
    setBotStatus(String(index), { username: creds.username, status: 'failed', position: null });
    scheduleReconnect(index, creds.username);
    return { ok: false, error: err.message };
  }
}

function parseKickReason(reason) {
  const str = typeof reason === 'string' ? reason : JSON.stringify(reason);
  const lower = (str || '').toLowerCase();
  return {
    isBanned: lower.includes('ban') || lower.includes('banned') || lower.includes('blacklisted'),
    isRestart: lower.includes('restart') || lower.includes('restarting') || lower.includes('server full') || lower.includes('server is starting'),
    isTimeout: lower.includes('timeout') || lower.includes('timed out') || lower.includes('connection lost'),
  };
}

function stopBot(index) {
  const instance = botInstances[index];
  if (!instance) return { ok: false, error: `Bot ${index} not running` };
  if (reconnectTimers[index]) { clearTimeout(reconnectTimers[index]); delete reconnectTimers[index]; }
  cleanupBot(index);
  setBotStatus(String(index), { username: instance.creds.username, status: 'stopped', position: null, stats: instance.hunter?.getStats() || {} });
  addLog(index, 'info', 'Bot stopped by user');
  return { ok: true };
}

function stopAll() {
  for (const index of Object.keys(botInstances)) stopBot(parseInt(index));
  return { ok: true };
}

function cleanupBot(index) {
  const instance = botInstances[index];
  if (!instance || instance.cleanedUp) return;
  instance.cleanedUp = true;
  try { BotCoordinator.unregisterBotUsername(instance.creds.username); } catch {}
  try { instance.hunter?.stop(); } catch {}
  try { instance.hostBot?.stop(); } catch {}
  try { if (instance.statusInterval) clearInterval(instance.statusInterval); } catch {}
  try { instance.bot.quit(); } catch {}
  try { instance.bot.removeAllListeners(); } catch {}
  try { metrics.remove(index); } catch {}
  delete botInstances[index];
}

function scheduleReconnect(index, username, overrideDelay) {
  if (shuttingDown) return;
  if (reconnectTimers[index]) return;

  let delay;
  if (overrideDelay) {
    delay = overrideDelay;
  } else {
    // Exponential backoff: 30s → 60s → 120s → 300s cap
    const failures = reconnectFailures[index] || 0;
    const base = config.delays.reconnectDelayMs || 30000;
    delay = Math.min(base * Math.pow(2, failures), config.delays.maxReconnectDelayMs || 300000);
    reconnectFailures[index] = failures + 1;
  }

  mainLog.info(`Bot-${index} reconnecting in ${delay / 1000}s`);
  addLog(index, 'info', `Reconnecting in ${delay / 1000}s`);
  reconnectTimers[index] = setTimeout(async () => {
    delete reconnectTimers[index];
    if (!shuttingDown && !botInstances[index]) {
      const result = await startBot(index, username);
      if (!result.ok) scheduleReconnect(index, username);
    }
  }, delay);
}

// --- Webhook Notifications ---
function sendWebhook(type, message) {
  const url = config.webhooks?.discordUrl;
  if (!url) return;

  const typeConfig = {
    cycle: config.webhooks?.notifyOnCycle,
    death: config.webhooks?.notifyOnDeath,
    kick: config.webhooks?.notifyOnKick,
  };
  if (typeConfig[type] === false) return;

  const payload = JSON.stringify({
    username: 'MCBOT',
    content: `[${type.toUpperCase()}] ${message}`,
  });

  try {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json' } }, () => {});
    req.on('error', (err) => { mainLog.warn(`Webhook failed: ${err.message}`); });
    req.write(payload);
    req.end();
  } catch {}
}

function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  mainLog.info('Shutting down...');
  for (const index of Object.keys(botInstances)) {
    const instance = botInstances[index];
    try {
      if (instance.isHost) {
        // Host bot - stop host bot logic
        if (instance.hostBot) instance.hostBot.stop();
        const hostStats = instance.hostBot?.getStats() || {};
        mainLog.info(`Host-${index} final: stored=${hostStats.totalStored || 0} shulkers=${hostStats.shulkerBoxes || 0}`);
      } else {
        // Hunter bot
        if (instance.hunter) {
          instance.hunter.stop();
          const stats = instance.hunter.getStats();
          mainLog.info(`Bot-${index} final: found=${stats.found} collected=${stats.collected} failed=${stats.failed} spawners=${stats.spawnerCount || 0}`);
        }
      }
    } catch {}
  }
  stopAll();
  stopAutoSave();
  if (scheduledCommands) scheduledCommands.stop();
  if (smartScheduler) smartScheduler.saveState();
  mainLog.info('State saved');
  setTimeout(() => process.exit(0), 2000);
}

function reloadConfig() {
  try {
    config = deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
    // Reload server profile if path changed
    const newProfile = loadServerProfile(config.serverProfile);
    if (newProfile !== serverProfile) {
      serverProfile = newProfile;
      mainLog.info(`Server profile reloaded: ${serverProfile?.name || 'none'}`);
    }
    mainLog.info('Config hot-reloaded from disk');
    return true;
  } catch (err) {
    mainLog.error(`Config reload failed: ${err.message}`);
    return false;
  }
}

// Get config with per-bot overrides applied
function getBotConfig(botIndex) {
  const overrides = config.botOverrides?.[String(botIndex)] || {};
  if (Object.keys(overrides).length === 0) return config;
  return deepMerge(config, overrides);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log('Created default config.json - edit it before running again.');
    process.exit(0);
  }
  try {
    return deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
  } catch (err) {
    console.error('Failed to parse config.json:', err.message);
    process.exit(1);
  }
}

function loadServerProfile(profilePath) {
  if (!profilePath) return null;
  const resolved = path.resolve(__dirname, '..', profilePath);
  if (!fs.existsSync(resolved)) {
    console.log(`[Profile] No profile at ${profilePath} - using hardcoded behavior`);
    return null;
  }
  try {
    const profile = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    return profile;
  } catch (err) {
    console.error(`[Profile] Failed to load ${profilePath}: ${err.message}`);
    return null;
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

// Global error handlers
process.on('uncaughtException', (err) => {
  if (mainLog) {
    mainLog.error(`UNCAUGHT EXCEPTION: ${err.message}`);
    mainLog.error(err.stack);
  } else {
    console.error('UNCAUGHT EXCEPTION:', err);
  }
  // Don't exit - try to keep running
});

process.on('unhandledRejection', (reason) => {
  if (mainLog) {
    mainLog.error(`UNHANDLED REJECTION: ${reason instanceof Error ? reason.message : reason}`);
    if (reason instanceof Error && reason.stack) mainLog.error(reason.stack);
  } else {
    console.error('UNHANDLED REJECTION:', reason);
  }
});
