const { sleep, waitForWindow, waitForChat } = require('./utils');

class Economy {
  constructor(bot, config, log) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.balance = 0;
    this.shopConfig = config.shop || {};
    this.econConfig = config.economy || {};
    this.pendingBalance = false;
    this.shopExplorer = null; // Set externally after shop exploration
    this.shopCommand = '/shop';
  }

  setShopExplorer(explorer) {
    this.shopExplorer = explorer;
    if (explorer) this.shopCommand = explorer.shopCommand || '/shop';
  }

  setupBalanceListener() {
    // Parse balance from chat - only when we sent /bal or from scoreboard
    this.bot.on('messagestr', (msg) => {
      const match = msg.match(/\$([\d,]+(?:\.\d+)?)/);
      if (!match) return;
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (isNaN(parsed) || parsed < 0) return;

      // Accept if we recently sent /bal, or if message looks like a balance response
      const lower = msg.toLowerCase();
      const isBalanceResponse = this.pendingBalance ||
        lower.includes('balance:') ||
        lower.includes('your balance') ||
        lower.includes('you have $');

      if (isBalanceResponse) {
        this.balance = Math.floor(parsed);
        this.pendingBalance = false;
        this.log.info(`Balance updated: $${this.balance}`);
      }
    });

    // Parse scoreboard sidebar for balance (some servers show it there)
    this.bot.on('scoreboard', (scoreboard) => {
      try {
        if (!scoreboard.items) return;
        for (const item of scoreboard.items) {
          const match = item.name?.match(/\$([\d,]+(?:\.\d+)?)/);
          if (match) {
            const parsed = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(parsed) && parsed >= 0) {
              this.balance = Math.floor(parsed);
            }
          }
        }
      } catch {}
    });
  }

  async refreshBalance() {
    this.pendingBalance = true;
    this.bot.chat('/bal');
    try {
      await waitForChat(this.bot, (msg) => {
      const lower = msg.toLowerCase();
        return lower.includes('balance') || (lower.includes('$') && /\d/.test(msg) && !lower.includes('shop'));
      }, 10000);
    } catch {
      this.log.warn('Balance refresh timed out');
    }
    // Safety reset: clear pending flag if no response received
    this.pendingBalance = false;
    return this.balance;
  }

  async buyPickaxe() {
    const cost = this.econConfig.pickaxeCost || 700;
    if (this.balance < cost) {
      this.log.warn(`Not enough for pickaxe: $${this.balance} < $${cost}`);
      return false;
    }
    // Try dynamic buy from explored shop map
    if (this.shopExplorer?.getShopMap()) {
      const result = await this.shopExplorer.buyItem(['diamond_pickaxe', 'pickaxe'], cost);
      if (result) { await this.refreshBalance(); return true; }
      this.log.info('Dynamic buy failed, falling back to slot path');
    }
    const slots = this.shopConfig.pickaxeSlots || [23, 50, 4, 34];
    return this.executeShopPath(slots, 'diamond_pickaxe', cost);
  }

  async buySteak(count = 1) {
    const costPer = this.econConfig.steakCost || 30;
    // Try dynamic buy first
    if (this.shopExplorer?.getShopMap()) {
      let bought = 0;
      for (let i = 0; i < count; i++) {
        if (this.balance < costPer) break;
        const result = await this.shopExplorer.buyItem(['cooked_beef', 'steak', 'cooked_porkchop'], costPer);
        if (result) { bought++; await sleep(300); }
        else break;
      }
      if (bought > 0) { await this.refreshBalance(); return true; }
      this.log.info('Dynamic steak buy failed, falling back to slot path');
    }
    // Fallback to hardcoded
    let bought = 0;
    const slots = this.shopConfig.steakSlots || [4, 25, 34];
    for (let i = 0; i < count; i++) {
      if (this.balance < costPer) break;
      const success = await this.executeShopPath(slots, 'cooked_beef', costPer);
      if (!success) break;
      bought++;
      await sleep(300);
    }
    return bought > 0;
  }

  async buyTotem() {
    const cost = this.econConfig.totemCost || 2500;
    if (this.balance < cost) {
      this.log.warn(`Not enough for totem: $${this.balance} < $${cost}`);
      return false;
    }
    if (this.shopExplorer?.getShopMap()) {
      const result = await this.shopExplorer.buyItem(['totem_of_undying', 'totem'], cost);
      if (result) { await this.refreshBalance(); return true; }
      this.log.info('Dynamic totem buy failed, falling back to slot path');
    }
    const slots = this.shopConfig.totemSlots || [23, 40, 34];
    return this.executeShopPath(slots, 'totem_of_undying', cost);
  }

  async executeShopPath(slotPath, itemName, cost) {
    let window;
    try {
      this.bot.chat('/shop');
      window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;

      for (let i = 0; i < slotPath.length; i++) {
        const slot = slotPath[i];
        // Verify item at slot before clicking (on final click, check item name)
        if (window && window.slots) {
          const slotItem = window.slots[slot];
          if (!slotItem) {
            this.log.warn(`Shop slot ${slot} is empty at step ${i + 1}/${slotPath.length}`);
          } else if (i === slotPath.length - 1) {
            const displayName = (slotItem.displayName || slotItem.name || '').toLowerCase();
            const expected = itemName.toLowerCase().replace(/_/g, ' ');
            // Check if the item roughly matches what we expect
            if (!displayName.includes(expected.split(' ')[0]) && expected !== 'unknown') {
              this.log.warn(`Shop slot mismatch at step ${i + 1}: expected "${expected}" found "${displayName}" at slot ${slot}`);
            }
          }
        }
        await this.bot.clickWindow(slot, 0, 0);
        await sleep(400);
      }

      this.bot.closeWindow(window);
      this.log.info(`Purchased ${itemName} for ~$${cost}`);
      // Re-verify actual balance
      await sleep(300);
      await this.refreshBalance();
      return true;
    } catch (err) {
      // Safety: close window if it's still open
      if (window) {
        try { this.bot.closeWindow(window); } catch {}
      }
      this.log.error(`Shop purchase failed (${itemName}): ${err.message}`);
      return false;
    }
  }
}

module.exports = { Economy };
