const { sleep, waitForWindow } = require('./utils');

const KEEP_ITEMS = new Set([
  'spawner', 'totem_of_undying', 'enchanted_golden_apple', 'golden_apple',
  'ender_pearl', 'obsidian', 'chest', 'crafting_table',
]);

const KEEP_PATTERNS = [
  /pickaxe/, /sword/, /helmet/, /chestplate/, /leggings/, /boots/,
];

const FOOD_ITEMS = new Set([
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'bread', 'golden_carrot', 'cooked_salmon', 'cooked_cod',
]);

const BUILDING_BLOCKS = new Set([
  'cobblestone', 'stone', 'dirt', 'oak_planks', 'spruce_planks',
  'birch_planks', 'deepslate', 'cobbled_deepslate',
]);

const MAX_BUILDING_BLOCKS = 192;

class SmartInventory {
  constructor(bot, log, economy) {
    this.bot = bot;
    this.log = log;
    this.economy = economy;
  }

  shouldKeep(item) {
    if (KEEP_ITEMS.has(item.name)) return true;
    if (KEEP_PATTERNS.some((p) => p.test(item.name))) return true;
    if (FOOD_ITEMS.has(item.name)) return true;
    return false;
  }

  categorizeInventory() {
    const items = this.bot.inventory.items();
    const toKeep = [];
    const toSell = [];

    let buildingBlockCount = 0;

    for (const item of items) {
      if (this.shouldKeep(item)) {
        toKeep.push(item);
        continue;
      }

      if (BUILDING_BLOCKS.has(item.name)) {
        buildingBlockCount += item.count;
        if (buildingBlockCount <= MAX_BUILDING_BLOCKS) {
          toKeep.push(item);
        } else {
          toSell.push(item);
        }
        continue;
      }

      toSell.push(item);
    }

    return { toKeep, toSell };
  }

  async sellItems(items) {
    if (items.length === 0) return;

    let window;
    try {
      this.bot.chat('/sellgui');
      window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;

      // When a GUI opens, player inventory slots are shifted by window.inventoryStart
      const invStart = window.inventoryStart || 54;

      for (const item of items) {
        try {
          // Use the remapped slot in the window context
          const windowSlot = item.slot + invStart;
          await this.bot.clickWindow(windowSlot, 0, 1);
          await sleep(150);
        } catch {
          // Try manual: pick up then place in GUI
          try {
            const windowSlot = item.slot + invStart;
            await this.bot.clickWindow(windowSlot, 0, 0);
            const emptyGuiSlot = window.slots.findIndex((s, i) => !s && i < invStart);
            if (emptyGuiSlot >= 0) {
              await this.bot.clickWindow(emptyGuiSlot, 0, 0);
            } else {
              await this.bot.clickWindow(windowSlot, 0, 0);
            }
            await sleep(150);
          } catch {
            // Skip
          }
        }
      }

      this.bot.closeWindow(window);
      this.log.info(`Sold ${items.length} item stacks via sellgui`);
      await sleep(500);

      if (this.economy) {
        await this.economy.refreshBalance();
      }
    } catch (err) {
      if (window) { try { this.bot.closeWindow(window); } catch {} }
      this.log.warn(`Sellgui failed: ${err.message}, falling back to disposal`);
      await this.disposeItems(items);
    }
  }

  async disposeItems(items) {
    if (items.length === 0) return;

    let window;
    try {
      this.bot.chat('/disposal');
      window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;

      const invStart = window.inventoryStart || 54;

      for (const item of items) {
        try {
          const windowSlot = item.slot + invStart;
          await this.bot.clickWindow(windowSlot, 0, 1);
          await sleep(150);
        } catch {
          try {
            const windowSlot = item.slot + invStart;
            await this.bot.clickWindow(windowSlot, 0, 0);
            const emptyGuiSlot = window.slots.findIndex((s, i) => !s && i < invStart);
            if (emptyGuiSlot >= 0) {
              await this.bot.clickWindow(emptyGuiSlot, 0, 0);
            } else {
              await this.bot.clickWindow(windowSlot, 0, 0);
            }
            await sleep(150);
          } catch {
            // Skip
          }
        }
      }

      this.bot.closeWindow(window);
      this.log.info(`Disposed of ${items.length} item stacks`);
      await sleep(500);
    } catch (err) {
      if (window) { try { this.bot.closeWindow(window); } catch {} }
      this.log.warn(`Disposal failed: ${err.message}`);
    }
  }

  async equipTotemOffhand() {
    const offhandSlot = this.bot.inventory.slots[45];
    if (offhandSlot && offhandSlot.name === 'totem_of_undying') return true;

    const totem = this.bot.inventory.items().find((i) => i.name === 'totem_of_undying');
    if (!totem) {
      this.log.warn('No totem available for offhand');
      return false;
    }

    try {
      await this.bot.equip(totem, 'off-hand');
      this.log.info('Totem equipped in offhand');
      return true;
    } catch (err) {
      this.log.error(`Failed to equip totem: ${err.message}`);
      return false;
    }
  }

  hasPickaxe() {
    return this.bot.inventory.items().some((i) => i.name.includes('pickaxe'));
  }

  getFoodCount() {
    return this.bot.inventory
      .items()
      .filter((i) => FOOD_ITEMS.has(i.name))
      .reduce((sum, i) => sum + i.count, 0);
  }

  hasTotem() {
    return this.bot.inventory.items().some((i) => i.name === 'totem_of_undying');
  }

  async manageInventory() {
    try {
      await this.equipTotemOffhand();

      const { toSell } = this.categorizeInventory();
      if (toSell.length > 0) {
        await this.sellItems(toSell);
      }

      // Buy essentials if needed
      if (!this.hasPickaxe() && this.economy) {
        await this.economy.refreshBalance();
        await this.economy.buyPickaxe();
      }

      const foodCount = this.getFoodCount();
      if (foodCount < 10 && this.economy) {
        const needed = Math.min(20 - foodCount, 64);
        await this.economy.refreshBalance();
        await this.economy.buySteak(needed);
      }

      if (!this.hasTotem() && this.economy) {
        await this.economy.refreshBalance();
        if (await this.economy.buyTotem()) {
          await this.equipTotemOffhand();
        }
      }
    } catch (err) {
      this.log.error(`Inventory management error: ${err.message}`);
    }
  }
}

async function equipPickaxe(bot, log) {
  const pickaxes = bot.inventory
    .items()
    .filter((item) => item.name.includes('pickaxe'))
    .sort((a, b) => {
      const tiers = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };
      const aTier = Object.entries(tiers).find(([k]) => a.name.includes(k))?.[1] || 0;
      const bTier = Object.entries(tiers).find(([k]) => b.name.includes(k))?.[1] || 0;
      return bTier - aTier;
    });

  const pickaxe = pickaxes[0];
  if (!pickaxe) {
    log.warn('No pickaxe in inventory!');
    return false;
  }

  try {
    await bot.equip(pickaxe, 'hand');
    log.info(`Equipped ${pickaxe.name}`);
    return true;
  } catch (err) {
    log.error(`Failed to equip pickaxe: ${err.message}`);
    return false;
  }
}

module.exports = { SmartInventory, equipPickaxe };
