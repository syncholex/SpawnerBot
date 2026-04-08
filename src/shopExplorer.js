// Shop Explorer: Opens shop GUI, recursively maps all items/categories/prices
// Builds a searchable database so autobuy can find items by keyword instead of hardcoded slots

const { sleep, waitForWindow } = require('./utils');

class ShopExplorer {
  constructor(bot, config, log) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.shopMap = null; // Populated after explore()
    this.shopCommand = '/shop';
  }

  // Main entry: explore the entire shop and return the map
  async explore(command) {
    this.shopCommand = command || this.config.shop?.openCommand || '/shop';
    this.log.info(`Exploring shop GUI: ${this.shopCommand}`);

    this.shopMap = {
      categories: {},  // categoryName -> { slot, items: { itemName -> { slot, price, lore } } }
      flatItems: [],    // All items flattened for searching
      rawSlots: {},     // slot -> { name, lore, nbt } for the root window
      exploredAt: Date.now(),
    };

    try {
      this.bot.chat(this.shopCommand);
      const rootWindow = await waitForWindow(this.bot, 10000);
      rootWindow.requiresConfirmation = false;

      // Map all slots in the root (category) window
      const rootItems = this.mapWindowSlots(rootWindow);
      this.shopMap.rawSlots = rootItems;

      // Try clicking into each non-empty slot to discover sub-categories
      for (const [slotStr, item] of Object.entries(rootItems)) {
        const slot = parseInt(slotStr);
        if (item.name === 'arrow_left' || item.name === 'arrow_right' ||
            item.name === 'barrier' || item.name === 'gray_stained_glass_pane') continue;

        this.log.info(`Exploring shop slot ${slot}: ${item.displayName || item.name}`);

        try {
          await this.bot.clickWindow(slot, 0, 0);
          await sleep(600);

          // Check if a new window opened (sub-category)
          const subWindow = await this.waitForNewWindow(rootWindow, 3000);
          if (subWindow) {
            subWindow.requiresConfirmation = false;
            const subItems = this.mapWindowSlots(subWindow);
            const categoryKey = this.sanitizeName(item.displayName || item.name);

            // Check if sub-items are purchasable (have prices in lore)
            const purchasable = {};
            for (const [subSlotStr, subItem] of Object.entries(subItems)) {
              const price = this.parsePrice(subItem.lore);
              if (price !== null || subItem.name !== 'air') {
                purchasable[subSlotStr] = {
                  ...subItem,
                  price,
                  slot: parseInt(subSlotStr),
                };
              }
            }

            this.shopMap.categories[categoryKey] = {
              rootSlot: slot,
              rootItem: item.name,
              items: purchasable,
            };

            // Add to flat list
            for (const purchItem of Object.values(purchasable)) {
              if (purchItem.price !== null) {
                this.shopMap.flatItems.push({
                  name: purchItem.name,
                  displayName: purchItem.displayName,
                  price: purchItem.price,
                  category: categoryKey,
                  path: [slot, purchItem.slot],
                  lore: purchItem.lore,
                });
              }
            }

            // Go back - close sub window and reopen root
            this.bot.closeWindow(subWindow);
            await sleep(300);
          }
        } catch (err) {
          this.log.debug(`Failed to explore slot ${slot}: ${err.message}`);
        }
      }

      this.bot.closeWindow(rootWindow);

      const itemCount = this.shopMap.flatItems.length;
      const catCount = Object.keys(this.shopMap.categories).length;
      this.log.info(`Shop explored: ${catCount} categories, ${itemCount} purchasable items`);

      return this.shopMap;
    } catch (err) {
      this.log.error(`Shop exploration failed: ${err.message}`);
      return null;
    }
  }

  // Map all slots in a window to their item data
  mapWindowSlots(window) {
    const items = {};
    if (!window || !window.slots) return items;

    for (let i = 0; i < window.slots.length; i++) {
      const slot = window.slots[i];
      if (!slot) continue;

      const lore = this.extractLore(slot);
      items[i] = {
        name: slot.name || 'unknown',
        displayName: slot.displayName || slot.name || 'unknown',
        count: slot.count || 1,
        slot: i,
        lore,
        nbt: slot.nbt ? JSON.stringify(slot.nbt) : null,
      };
    }
    return items;
  }

  // Extract lore text from item NBT
  extractLore(slot) {
    const loreLines = [];
    try {
      // mineflayer stores lore in slot.nbt.value.display.value.Lore.value.value
      const nbt = slot.nbt;
      if (!nbt) return '';

      // Try different NBT paths
      const display = nbt.value?.display?.value || nbt.value?.display;
      if (display) {
        const loreArray = display.Lore?.value?.value || display.Lore?.value || [];
        for (const line of loreArray) {
          if (typeof line === 'string') {
            loreLines.push(line.replace(/§[0-9a-fk-or]/g, ''));
          } else if (line.value !== undefined) {
            loreLines.push(String(line.value).replace(/§[0-9a-fk-or]/g, ''));
          } else if (line.text !== undefined) {
            loreLines.push(line.text.replace(/§[0-9a-fk-or]/g, ''));
          } else if (typeof line === 'object' && line.extra) {
            const extras = Array.isArray(line.extra) ? line.extra : [line.extra];
            for (const extra of extras) {
              loreLines.push((extra.text || String(extra)).replace(/§[0-9a-fk-or]/g, ''));
            }
          }
        }
      }
    } catch {}
    return loreLines.join('\n');
  }

  // Parse price from lore text (e.g. "Price: $700" or "Cost: 30 coins")
  parsePrice(lore) {
    if (!lore) return null;

    // Match dollar amounts
    const dollarMatch = lore.match(/\$(\d[\d,]*)/);
    if (dollarMatch) return parseFloat(dollarMatch[1].replace(/,/g, ''));

    // Match "Price: 700" or "Cost: 30"
    const priceMatch = lore.match(/(?:price|cost|buy)[^\d]*(\d[\d,]*)/i);
    if (priceMatch) return parseFloat(priceMatch[1].replace(/,/g, ''));

    return null;
  }

  // Wait briefly for a new window (different from the current one)
  waitForNewWindow(currentWindow, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const currentId = currentWindow?.id;
      const timer = setTimeout(() => {
        this.bot.removeListener('windowOpen', onOpen);
        resolve(null);
      }, timeoutMs);

      const onOpen = (window) => {
        if (window.id !== currentId) {
          clearTimeout(timer);
          this.bot.removeListener('windowOpen', onOpen);
          resolve(window);
        }
      };

      this.bot.once('windowOpen', onOpen);
    });
  }

  // Search for items by keyword
  findItem(keywords) {
    if (!this.shopMap) return null;
    const kws = Array.isArray(keywords) ? keywords : [keywords];

    for (const item of this.shopMap.flatItems) {
      const name = (item.name || '').toLowerCase();
      const display = (item.displayName || '').toLowerCase();
      const match = kws.some(kw => name.includes(kw.toLowerCase()) || display.includes(kw.toLowerCase()));
      if (match) return item;
    }
    return null;
  }

  // Find all items matching keywords
  findItems(keywords) {
    if (!this.shopMap) return [];
    const kws = Array.isArray(keywords) ? keywords : [keywords];

    return this.shopMap.flatItems.filter(item => {
      const name = (item.name || '').toLowerCase();
      const display = (item.displayName || '').toLowerCase();
      return kws.some(kw => name.includes(kw.toLowerCase()) || display.includes(kw.toLowerCase()));
    });
  }

  // Buy an item using the explored shop map (navigates GUI dynamically)
  async buyItem(keywords, maxPrice = Infinity) {
    if (!this.shopMap) {
      this.log.warn('Shop not explored yet - cannot buy dynamically');
      return false;
    }

    const item = this.findItem(keywords);
    if (!item) {
      this.log.warn(`No shop item found matching: ${keywords}`);
      return false;
    }

    if (item.price !== null && item.price > maxPrice) {
      this.log.warn(`Item ${item.displayName} costs $${item.price} > max $${maxPrice}`);
      return false;
    }

    this.log.info(`Buying ${item.displayName} (path: ${item.path.join(' -> ')}) for $${item.price || '?'}`);

    try {
      this.bot.chat(this.shopCommand);
      const window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;

      // Navigate the path: first click category slot, then item slot
      for (let i = 0; i < item.path.length; i++) {
        await this.bot.clickWindow(item.path[i], 0, 0);
        await sleep(500);

        // If this isn't the last click, wait for sub-window
        if (i < item.path.length - 1) {
          await sleep(300);
        }
      }

      this.bot.closeWindow(window);
      this.log.info(`Purchased ${item.displayName}`);
      return true;
    } catch (err) {
      this.log.error(`Dynamic buy failed for ${item.displayName}: ${err.message}`);
      return false;
    }
  }

  // Get the shop map (for API / persistence)
  getShopMap() {
    return this.shopMap;
  }

  // Load a previously explored shop map
  loadShopMap(map) {
    this.shopMap = map;
  }

  sanitizeName(name) {
    return (name || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  }
}

module.exports = { ShopExplorer };
