// Spawner Hunter: Core hunting logic - scans for spawners, navigates, mines
// Integrates with survival, economy, inventory, metrics, and coordination

const mcData = require('minecraft-data');
const { sleep, waitForWindow } = require('./utils');
const { equipPickaxe } = require('./smartInventory');
const { addSpawner, markMined, isKnown, addExploredChunk } = require('./spawnerStore');
const { goals } = require('mineflayer-pathfinder');
const { Explorer } = require('./explorer');
const { BotSurvival } = require('./botSurvival');
const { BotCoordinator, botEvents } = require('./botCoordinator');
const { ItemTransfer } = require('./itemTransfer');
const { metrics } = require('./botMetrics');
const { AntiDetection } = require('./antiDetection');
const { ItemLending } = require('./itemLending');

const SPAWNER_TYPES = {
  'zombie': 'Zombie', 'skeleton': 'Skeleton', 'spider': 'Spider',
  'cave_spider': 'Cave Spider', 'blaze': 'Blaze', 'silverfish': 'Silverfish',
  'creeper': 'Creeper', 'enderman': 'Enderman', 'witch': 'Witch',
  'slime': 'Slime', 'magma_cube': 'Magma Cube', 'phantom': 'Phantom',
  'guardian': 'Guardian', 'evoker': 'Evoker', 'vindicator': 'Vindicator',
  'pillager': 'Pillager', 'ravager': 'Ravager', 'shulker': 'Shulker',
  'wither_skeleton': 'Wither Skeleton', 'stray': 'Stray', 'husk': 'Husk',
  'drowned': 'Drowned', 'mooshroom': 'Mooshroom', 'pig': 'Pig',
};

const MAX_DEATHS_PER_WINDOW = 5;
const DEATH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

class SpawnerHunter {
  constructor(bot, config, botIndex, totalBots, log) {
    this.bot = bot;
    this.log = log;
    this.config = config;
    this.botIndex = botIndex;
    this.totalBots = totalBots;
    this.mcData = mcData(bot.version);
    this.spawnerId = this.mcData.blocksByName.spawner?.id;
    this.running = false;
    this.explorer = null;
    this.stats = { found: 0, collected: 0, failed: 0, spawnerTypes: {} };
    this.smartInventory = null;
    this.economy = null;
    this.inventoryCheckCounter = 0;
    this.survival = null;
    this.coordinator = null;
    this.shouldCycle = false;
    this.undergroundCounter = 0;
    this.hostTransferCounter = 0;
    this._hostTransferFn = null;
    this._serverManager = null;
    this._antiDetection = null;
    this._itemLending = null;
    this._scheduler = null;
    this.deathTimestamps = []; // Death rate limiting

    if (!this.spawnerId) log.error('Could not find spawner block ID for this version!');
  }

  setDependencies(smartInventory, economy) {
    this.smartInventory = smartInventory;
    this.economy = economy;
  }

  async start() {
    this.running = true;
    this.log.info('Spawner hunter started');

    // Metrics initialized by index.js on spawn - don't re-init here

    this.survival = new BotSurvival(this.bot, this.config, this.log);
    this.survival.start();
    this.survival.hasCompletedFirstRtp = true;

    this.coordinator = new BotCoordinator(this.botIndex, this.config, this.log, this.bot);

    // AntiDetection and ItemLending are wired by index.js after this start() call
    // Only set up lending listener if index.js hasn't already created the lending instance
    if (!this._antiDetection) {
      this._antiDetection = new AntiDetection(this.bot, this.log, {
        socialBehaviors: this.config.antiDetection?.socialBehaviors || false,
      });
      this._antiDetection.start();
    }

    if (!this._itemLending) {
      this._itemLending = new ItemLending(this.bot, this.config, this.log, this.botIndex);
    }
    this._setupLendingListener();

    await sleep(3000 + this.botIndex * 2000);

    this.explorer = new Explorer(this.bot, this.config, this.botIndex, this.totalBots, this.log);
    this.explorer.startExploring();

    while (this.running) {
      try {
        if (this.survival && this.survival.shouldLogout) {
          this.log.warn('Player detected - logging out for 2 hours');
          metrics.recordPlayerAvoidance(this.botIndex);
          this.stop();
          this.bot.quit('Player avoidance');
          return;
        }

        if (this.survival && this.survival.isPaused) {
          await sleep(2000);
          continue;
        }

        this.trackChunk();
        if (this.coordinator) {
          const pos = this.bot.entity.position;
          this.coordinator.updatePosition(pos.x, pos.z);
          metrics.recordDistance(this.botIndex, pos);
        }

        if (this.survival && this.survival.checkStuck()) {
          await this.survival.recoverFromStuck();
          continue;
        }

        // Pickaxe durability - try lending first, then buy
        if (this.survival && this.survival.needsNewPickaxe() && this.economy) {
          this.log.warn('Pickaxe low durability - trying to borrow or buy replacement');
          let gotPickaxe = false;
          if (this._itemLending) {
            try {
              gotPickaxe = await this._itemLending.requestItem('pickaxe', 1, this._getBotInstances());
              if (gotPickaxe) metrics.recordTransfer(this.botIndex);
            } catch (e) { this.log.debug(`Lending request failed: ${e.message}`); }
          }
          if (!gotPickaxe) {
            await this.economy.refreshBalance();
            await this.economy.buyPickaxe();
            metrics.recordPurchase(this.botIndex, this.config.economy?.pickaxeCost || 700);
          }
        }

        this.undergroundCounter++;
        if (this.undergroundCounter >= 200) {
          this.undergroundCounter = 0;
          await this.loadUndergroundChunks();
        }

        const spawners = this.scanForSpawners();
        if (spawners.length > 0) {
          this.explorer.stop();
          await this.collectSpawners(spawners);
          if (this.running) this.explorer.startExploring();
          continue;
        }

        this.inventoryCheckCounter++;
        if (this.inventoryCheckCounter >= 60) {
          this.inventoryCheckCounter = 0;

          // Check inventory full status
          const inventoryFull = this.isInventoryFull();
          if (this.smartInventory) {
            await this.smartInventory.manageInventory();
          }

          if (this.checkSpawnerCapacity()) {
            this.log.info('Spawner capacity reached - marking for cycle');
            metrics.recordCycle(this.botIndex);
            this.shouldCycle = true;
            this.stop();
            return;
          }

          this.hostTransferCounter++;
          if (this.hostTransferCounter >= 30) {
            this.hostTransferCounter = 0;
            await this.tryTransferToHost();
          }

          if (this.coordinator && this.coordinator.canClaimDaily()) {
            try {
              const serverMgr = this.getServerManager();
              if (serverMgr) {
                await serverMgr.claimDaily();
                this.coordinator.markDailyClaimed();
                metrics.recordDaily(this.botIndex);
                this.log.info('Auto-claimed daily reward');
              }
            } catch (e) { this.log.debug(`Daily claim failed: ${e.message}`); }
          }

          if (this.coordinator && this.coordinator.canRtp()) {
            try {
              const serverMgr = this.getServerManager();
              if (serverMgr) {
                await serverMgr.rtp();
                await serverMgr.setHome();
                this.coordinator.markRtpUsed();
                metrics.recordRtp(this.botIndex);
                if (this.survival) this.survival.hasCompletedFirstRtp = true;
                this.explorer.stop();
                this.explorer.startExploring();
              }
            } catch (e) { this.log.debug(`Underground dig failed: ${e.message}`); }
          }
        }

        if (this.coordinator) this.coordinator.recordSuccess();

      } catch (err) {
        this.log.error(`Hunter error: ${err.message}`);
        if (this.coordinator && this.coordinator.recordFailure()) {
          this.log.error('Too many failures - stopping bot');
          this.stop();
          return;
        }
      }

      const baseTick = this.config.spawnerHunting?.explorationTickMs || 1000;
      const variance = baseTick * 0.3;
      await sleep(baseTick + (Math.random() - 0.5) * variance);
    }

    this.stop();
  }

  // Listen for lending requests from other bots
  _setupLendingListener() {
    this._lendingHandler = async (msg) => {
      if (msg.to !== this.bot.username) return;
      if (!msg.body.startsWith('lend ')) return;

      const [, itemName, countStr] = msg.body.split(' ');
      const count = parseInt(countStr) || 1;
      this.log.info(`Lending request from ${msg.from}: ${count}x ${itemName}`);

      try {
        await this._itemLending.dropForLender(itemName, count);
        if (this.coordinator) {
          this.coordinator.sendBotMessage(msg.from, `lent ${itemName} ${count}`);
        }
      } catch (err) {
        this.log.warn(`Failed to lend ${itemName}: ${err.message}`);
      }
    };
    botEvents.on('bot-message', this._lendingHandler);
  }

  _removeLendingListener() {
    if (this._lendingHandler) {
      botEvents.removeListener('bot-message', this._lendingHandler);
      this._lendingHandler = null;
    }
  }

  getServerManager() {
    return this._serverManager || null;
  }

  _getBotInstances() {
    return this._botInstances || {};
  }

  stop() {
    this.running = false;
    if (this.explorer) this.explorer.stop();
    if (this.survival) this.survival.stop();
    if (this.coordinator) this.coordinator.cleanup();
    if (this._antiDetection) this._antiDetection.stop();
    this._removeLendingListener();
  }

  // Check if too many deaths recently (death loop protection)
  recordDeath() {
    const now = Date.now();
    this.deathTimestamps.push(now);
    // Prune old entries
    this.deathTimestamps = this.deathTimestamps.filter(t => now - t < DEATH_WINDOW_MS);
    if (this.deathTimestamps.length >= MAX_DEATHS_PER_WINDOW) {
      this.log.error(`Death loop detected: ${this.deathTimestamps.length} deaths in ${DEATH_WINDOW_MS / 60000} minutes`);
      return true; // Should stop
    }
    return false;
  }

  isInventoryFull() {
    try {
      const items = this.bot.inventory.items();
      return items.length >= 35;
    } catch { return false; }
  }

  trackChunk() {
    const pos = this.bot.entity.position;
    addExploredChunk(Math.floor(pos.x / 16), Math.floor(pos.z / 16));
  }

  async loadUndergroundChunks() {
    try {
      const pos = this.bot.entity.position;
      for (let dy = 0; dy < 3; dy++) {
        const block = this.bot.blockAt(pos.offset(0, -(dy + 1), 0));
        if (block && block.name !== 'bedrock' && block.name !== 'air') {
          await this.bot.dig(block);
          await sleep(200);
        }
      }
    } catch (e) { this.log.debug(`Underground chunk load failed: ${e.message}`); }
  }

  scanForSpawners() {
    if (!this.spawnerId) return [];
    const positions = this.bot.findBlocks({
      matching: this.spawnerId,
      maxDistance: this.config.spawnerHunting?.maxDistanceToSpawner || 128,
      count: 32,
    });

    if (!positions) return [];

    const newSpawners = [];
    for (const pos of positions) {
      if (isKnown(pos.x, pos.y, pos.z)) continue;
      const type = this.getSpawnerType(pos);
      addSpawner(pos.x, pos.y, pos.z, this.botIndex, type);
      this.stats.found++;
      metrics.recordFound(this.botIndex);
      if (!this.stats.spawnerTypes[type]) this.stats.spawnerTypes[type] = 0;
      this.stats.spawnerTypes[type]++;
      this.log.info(`Spawner found at ${pos.x}, ${pos.y}, ${pos.z} (type: ${type})`);
      newSpawners.push(pos);
    }
    return newSpawners;
  }

  getSpawnerType(pos) {
    try {
      const block = this.bot.blockAt(pos);
      if (!block) return 'unknown';

      if (block.blockEntity) {
        const paths = [
          block.blockEntity.SpawnData?.entity?.id,
          block.blockEntity.SpawnData?.entity?.id?.value,
          block.blockEntity.spawnData?.entity?.id,
          block.blockEntity.nbtData?.SpawnData?.entity?.id,
        ];
        for (const entityId of paths) {
          if (entityId) {
            const id = typeof entityId === 'string' ? entityId : (entityId.value || String(entityId));
            return SPAWNER_TYPES[id] || id;
          }
        }

        const nbt = block.blockEntity;
        if (nbt) {
          const spawnData = nbt.SpawnData || nbt.spawnData || nbt.value?.SpawnData;
          if (spawnData) {
            const entity = spawnData.entity || spawnData.Entity || spawnData.value?.entity?.value;
            if (entity) {
              const id = entity.id || entity.Id || entity.value?.id?.value;
              if (id) {
                const idStr = typeof id === 'string' ? id : (id.value || String(id));
                return SPAWNER_TYPES[idStr] || idStr;
              }
            }
          }
        }
      }

      const chunk = this.bot.world?.getColumn?.(Math.floor(pos.x / 16), Math.floor(pos.z / 16));
      if (chunk) {
        const tile = chunk.blockEntities?.find?.(t => t.x === pos.x && t.y === pos.y && t.z === pos.z);
        if (tile) {
          const nbtData = tile.nbtData || tile;
          const spawnData = nbtData.SpawnData || nbtData.spawnData;
          if (spawnData) {
            const entityId = spawnData.entity?.id || spawnData.Entity?.id;
            if (entityId) {
              const idStr = typeof entityId === 'string' ? entityId : (entityId.value || String(entityId));
              return SPAWNER_TYPES[idStr] || idStr;
            }
          }
        }
      }

      if (block.getProperties) {
        try {
          const entities = this.bot.world?.getBlockEntities?.();
          if (entities) {
            const entity = entities.find(e => e.x === pos.x && e.y === pos.y && e.z === pos.z);
            if (entity?.nbt) {
              const deepFind = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                if (obj.SpawnData || obj.spawnData) {
                  const sd = obj.SpawnData || obj.spawnData;
                  const eid = sd.entity?.id || sd.Entity?.id;
                  if (eid) return typeof eid === 'string' ? eid : eid.value;
                }
                for (const val of Object.values(obj)) {
                  const r = deepFind(val);
                  if (r) return r;
                }
                return null;
              };
              const found = deepFind(entity.nbt);
              if (found) return SPAWNER_TYPES[found] || found;
            }
          }
        } catch (e) { this.log.debug(`Inventory manage failed: ${e.message}`); }
      }
    } catch (e) { this.log.debug(`Main loop error: ${e.message}`); }
    return 'unknown';
  }

  async collectSpawners(positions) {
    for (const pos of positions) {
      if (!this.running) break;
      if (this.survival && this.survival.isPaused) { await sleep(2000); continue; }

      const type = this.getSpawnerType(pos);
      try {
        await this.collectOne(pos);
        markMined(pos.x, pos.y, pos.z, this.botIndex);
        this.stats.collected++;
        metrics.recordMined(this.botIndex);
        this.log.info(`Spawner mined! (${this.stats.collected}/${this.stats.found}) [${type}]`);
      } catch (err) {
        this.stats.failed++;
        metrics.recordFailed(this.botIndex);
        this.log.error(`Failed to mine spawner at ${pos.x}, ${pos.y}, ${pos.z}: ${err.message}`);
      }
      await sleep(500);
    }
  }

  async collectOne(pos) {
    const block = this.bot.blockAt(pos);
    if (!block || block.name !== 'spawner') {
      this.log.warn(`Spawner no longer at ${pos.x}, ${pos.y}, ${pos.z}`);
      return;
    }

    if (this.survival && !this.survival.isSafePosition(pos)) {
      throw new Error('Dangerous position');
    }

    const goal = new goals.GoalBlock(pos.x, pos.y, pos.z);
    this.bot.pathfinder.setGoal(goal);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup(); this.bot.pathfinder.setGoal(null); reject(new Error('Navigation timeout'));
      }, this.config.spawnerHunting?.collectTimeoutMs || 60000);

      const onReached = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Pathfinder could not reach spawner')); };
      const cleanup = () => {
        clearTimeout(timeout);
        this.bot.removeListener('goal_reached', onReached);
        this.bot.removeListener('path_error', onError);
      };

      this.bot.once('goal_reached', onReached);
      this.bot.once('path_error', onError);
    });

    await equipPickaxe(this.bot, this.log);
    if (this.smartInventory) await this.smartInventory.manageInventory();
    await this.bot.collectBlock.collect(block);
  }

  checkSpawnerCapacity() {
    const maxStacks = this.config.spawnerHunting?.maxSpawnerStacksPerBot || 0;
    if (maxStacks <= 0) return false;

    const maxItems = maxStacks * 64;
    let totalSpawners = 0;
    for (const item of this.bot.inventory.items()) {
      if (item.name === 'spawner') totalSpawners += item.count;
    }

    if (totalSpawners >= maxItems) {
      this.log.info(`Spawner capacity reached: ${totalSpawners}/${maxItems}`);
      return true;
    }
    return false;
  }

  async tryTransferToHost() {
    try {
      const spawners = this.bot.inventory.items().filter(i => i.name === 'spawner');
      const totalSpawners = spawners.reduce((s, i) => s + i.count, 0);
      const threshold = this.config.hostBot?.spawnerTransferThreshold || 64;

      if (totalSpawners < threshold) return;
      if (!this._hostTransferFn) return;

      this.log.info(`Spawner count ${totalSpawners} >= threshold ${threshold} - transferring to host`);

      const wasExploring = this.explorer?.exploring;
      if (this.explorer) this.explorer.stop();

      try {
        await this._hostTransferFn(totalSpawners);
        metrics.recordTransfer(this.botIndex);
        this.log.info('Spawner transfer to host complete');
      } catch (err) {
        this.log.error(`Host transfer failed: ${err.message}`);
      }

      if (wasExploring && this.running && this.explorer) {
        this.explorer.startExploring();
      }
    } catch (err) {
      this.log.error(`tryTransferToHost error: ${err.message}`);
    }
  }

  getStats() {
    let spawnerCount = 0;
    try {
      spawnerCount = this.bot.inventory.items().filter(i => i.name === 'spawner').reduce((s, i) => s + i.count, 0);
    } catch (e) { this.log.debug(`Spawner count failed: ${e.message}`); }
    return { ...this.stats, spawnerCount };
  }
}

module.exports = { SpawnerHunter };
