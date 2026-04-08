// Host Bot: Stays at home, accepts TPA from hunters, stores spawners in shulker boxes
// 1 host bot per 10 hunting bots. Buys black shulker boxes from shop.

const { sleep, waitForWindow } = require('./utils');
const { BotCoordinator } = require('./botCoordinator');

class HostBot {
  constructor(bot, config, log, botIndex, economy, smartInventory) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.botIndex = botIndex;
    this.economy = economy;
    this.smartInventory = smartInventory;
    this.running = true;
    this.assignedHunters = [];     // Hunter bot indices assigned to this host
    this.totalStored = 0;          // Total spawners stored in shulkers
    this.shulkerCount = 0;         // Number of shulker boxes with spawners
    this.pendingPickups = 0;       // Spawners picked up but not yet boxed
    this.homePosition = null;
    this.storingInProgress = false;
  }

  // Assign hunter bots to this host (called from index.js)
  assignHunters(hunterIndices) {
    this.assignedHunters = hunterIndices;
    this.log.info(`Assigned ${hunterIndices.length} hunters: [${hunterIndices.join(', ')}]`);
  }

  // Get the username hunters should TPA to
  getUsername() {
    return this.bot.username;
  }

  start() {
    this.running = true;
    this.homePosition = this.bot.entity.position.clone();
    this.log.info('Host bot active - waiting for spawner deliveries');

    // Auto-accept TPA from assigned hunters
    this.setupTpaListener();

    // Watch for dropped items (spawners) and pick them up
    this.setupItemPickup();

    // Periodically store loose spawners into shulker boxes
    this.startStorageLoop();

    // Periodic status update
    this.startStatusLoop();
  }

  stop() {
    this.running = false;
    if (this.storageInterval) clearInterval(this.storageInterval);
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  // --- TPA Handling ---
  setupTpaListener() {
    this.bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString().toLowerCase();
      // Auto-accept all TPA requests (hunter bots are registered usernames)
      if (text.includes('requested to teleport') || text.includes('wants to teleport')) {
        this.log.info('TPA request received - accepting...');
        setTimeout(() => {
          try {
            this.bot.chat('/tpaccept');
          } catch {}
        }, 500 + Math.random() * 1500);
      }
    });
  }

  // --- Item Pickup ---
  setupItemPickup() {
    // Mineflayer auto-picks up items within range, but we track what we get
    this.bot.on('playerCollect', (collector, entity) => {
      if (collector.username === this.bot.username) {
        try {
          const item = entity.getDroppedItem?.();
          if (item && item.name === 'spawner') {
            this.pendingPickups += item.count;
            this.log.info(`Picked up ${item.count}x spawner (${this.pendingPickups} loose)`);
          }
        } catch {}
      }
    });
  }

  // --- Shulker Box Storage Loop ---
  startStorageLoop() {
    const intervalMs = this.config.hostBot?.storageIntervalMs || 15000;
    this.storageInterval = setInterval(async () => {
      if (!this.running || this.storingInProgress) return;
      await this.storeLooseSpawners();
    }, intervalMs);
  }

  async storeLooseSpawners() {
    if (this.storingInProgress) return;

    const spawners = this.bot.inventory.items().filter(i => i.name === 'spawner');
    if (spawners.length === 0) return;

    const totalSpawners = spawners.reduce((s, i) => s + i.count, 0);
    if (totalSpawners < 1) return;

    this.storingInProgress = true;
    this.log.info(`Storing ${totalSpawners} spawners in shulker boxes...`);

    try {
      // Ensure we have a shulker box
      let shulker = this.bot.inventory.items().find(i =>
        i.name === 'black_shulker_box' || i.name === 'shulker_box'
      );

      if (!shulker) {
        this.log.info('No empty shulker box - buying one...');
        await this.buyShulkerBox();
        await sleep(1000);
        shulker = this.bot.inventory.items().find(i =>
          i.name === 'black_shulker_box' || i.name === 'shulker_box'
        );
      }

      if (!shulker) {
        this.log.warn('Failed to get shulker box - will retry later');
        return;
      }

      // Place shulker box
      const placed = await this.placeShulkerBox(shulker);
      if (!placed) {
        this.log.warn('Failed to place shulker box');
        return;
      }

      await sleep(500);

      // Open the shulker box
      const shulkerBlock = this.findPlacedShulker();
      if (!shulkerBlock) {
        this.log.warn('Could not find placed shulker box');
        return;
      }

      const window = await this.openShulkerBox(shulkerBlock);
      if (!window) return;

      // Transfer spawners into the shulker box
      const invStart = window.inventoryStart || 54;
      let transferred = 0;

      const spawnerItems = this.bot.inventory.items().filter(i => i.name === 'spawner');
      for (const item of spawnerItems) {
        try {
          // Shift-click spawner from inventory into shulker box
          const windowSlot = item.slot + invStart;
          await this.bot.clickWindow(windowSlot, 0, 1); // Right-click with shift
          transferred += item.count;
          await sleep(200);
        } catch (err) {
          this.log.warn(`Failed to transfer spawner: ${err.message}`);
          // Try without shift (manual pick-place)
          try {
            const emptySlot = window.slots.findIndex((s, i) => !s && i < invStart);
            if (emptySlot >= 0) {
              const windowSlot = item.slot + invStart;
              await this.bot.clickWindow(windowSlot, 0, 0);
              await sleep(150);
              await this.bot.clickWindow(emptySlot, 0, 0);
              transferred += item.count;
              await sleep(200);
            }
          } catch {}
        }
      }

      // Close the shulker box window
      this.bot.closeWindow(window);
      await sleep(500);

      // Break the shulker box to pick it up (with items inside)
      await this.breakShulkerBox(shulkerBlock);

      this.totalStored += transferred;
      this.shulkerCount = this.bot.inventory.items().filter(i =>
        i.name === 'black_shulker_box' || i.name === 'shulker_box'
      ).length;
      this.pendingPickups = 0;

      this.log.info(`Stored ${transferred} spawners (total: ${this.totalStored} in ${this.shulkerCount} shulker boxes)`);
    } catch (err) {
      this.log.error(`Shulker storage failed: ${err.message}`);
    } finally {
      this.storingInProgress = false;
    }
  }

  async buyShulkerBox() {
    try {
      // Try shop explorer first
      if (this.economy.shopExplorer?.getShopMap()) {
        const bought = await this.economy.shopExplorer.buyItem(['black_shulker_box', 'shulker_box']);
        if (bought) {
          this.log.info('Bought shulker box from shop (dynamic)');
          return;
        }
      }

      // Fallback: try /shop GUI with common slot paths
      this.bot.chat('/shop');
      const window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;

      // Try to find and click the shulker box in the shop
      for (let i = 0; i < window.slots.length; i++) {
        const slot = window.slots[i];
        if (!slot) continue;
        if (slot.name === 'black_shulker_box' || slot.name === 'shulker_box') {
          await this.bot.clickWindow(i, 0, 0);
          await sleep(500);
          this.bot.closeWindow(window);
          this.log.info('Bought shulker box from shop');
          return;
        }
      }

      this.bot.closeWindow(window);
      this.log.warn('Could not find shulker box in shop');
    } catch (err) {
      this.log.error(`Failed to buy shulker box: ${err.message}`);
    }
  }

  async placeShulkerBox(shulkerItem) {
    try {
      // Find a safe place to put it (on the ground near us)
      const pos = this.bot.entity.position;
      const face = { x: 0, y: -1, z: 0 }; // Place on block below (on ground)

      // Find the block we're standing on
      const groundBlock = this.bot.blockAt(pos.offset(0, -1, 0));
      if (!groundBlock) return false;

      await this.bot.equip(shulkerItem, 'hand');
      await sleep(300);
      await this.bot.placeBlock(groundBlock, face);
      await sleep(500);
      this.log.info('Placed shulker box');
      return true;
    } catch (err) {
      this.log.error(`Failed to place shulker box: ${err.message}`);
      return false;
    }
  }

  findPlacedShulker() {
    try {
      const pos = this.bot.entity.position;
      // Check nearby blocks for shulker box
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            const block = this.bot.blockAt(pos.offset(dx, dy, dz));
            if (block && (block.name === 'black_shulker_box' || block.name === 'shulker_box')) {
              return block;
            }
          }
        }
      }
    } catch {}
    return null;
  }

  async openShulkerBox(block) {
    try {
      const window = await this.bot.openChest(block);
      window.requiresConfirmation = false;
      this.log.info('Opened shulker box');
      return window;
    } catch (err) {
      this.log.error(`Failed to open shulker box: ${err.message}`);
      return null;
    }
  }

  async breakShulkerBox(block) {
    try {
      // Equip a pickaxe to break it faster
      const pickaxe = this.bot.inventory.items().find(i => i.name.includes('pickaxe'));
      if (pickaxe) await this.bot.equip(pickaxe, 'hand');
      await sleep(200);
      await this.bot.dig(block);
      await sleep(1000); // Wait for item pickup
      this.log.info('Broke and collected shulker box');
    } catch (err) {
      this.log.error(`Failed to break shulker box: ${err.message}`);
    }
  }

  // --- Status ---
  startStatusLoop() {
    this.statusInterval = setInterval(() => {
      if (!this.running) return;
      try {
        const spawners = this.bot.inventory.items().filter(i => i.name === 'spawner');
        const looseCount = spawners.reduce((s, i) => s + i.count, 0);
        const shulkers = this.bot.inventory.items().filter(i =>
          i.name === 'black_shulker_box' || i.name === 'shulker_box'
        );

        this.log.info(`Status: ${looseCount} loose spawners, ${shulkers.length} shulker boxes, ${this.totalStored} total stored`);
      } catch {}
    }, 60000);
  }

  getStats() {
    try {
      const spawners = this.bot.inventory.items().filter(i => i.name === 'spawner');
      const looseCount = spawners.reduce((s, i) => s + i.count, 0);
      const shulkers = this.bot.inventory.items().filter(i =>
        i.name === 'black_shulker_box' || i.name === 'shulker_box'
      );
      return {
        type: 'host',
        looseSpawners: looseCount,
        shulkerBoxes: shulkers.length,
        totalStored: this.totalStored,
        assignedHunters: this.assignedHunters,
        pendingPickups: this.pendingPickups,
      };
    } catch {
      return { type: 'host', looseSpawners: 0, shulkerBoxes: 0, totalStored: 0 };
    }
  }
}

module.exports = { HostBot };
