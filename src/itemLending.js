// Item lending: bots share items with each other instead of always buying from shop
// Uses bot-to-bot messaging via /msg to trigger lender-side drops

const { sleep } = require('./utils');
const { botEvents } = require('./botCoordinator');

class ItemLending {
  constructor(bot, config, log, botIndex) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.botIndex = botIndex;
    this.lendingHistory = [];
  }

  // Request an item from another bot. Sends a /msg to trigger the lender to drop.
  async requestItem(itemName, count = 1, botInstances) {
    if (!botInstances) return false;
    if (this.config.coordination?.tpaBetweenBots === false) return false;

    const lender = this.findLender(itemName, count, botInstances);
    if (!lender) return false;

    this.log.info(`Requesting ${count}x ${itemName} from Bot-${lender.index} (${lender.username})`);

    // Send bot-to-bot message requesting the item
    this.bot.chat(`/msg ${lender.username} [bot-msg] ${this.bot.username} lend ${itemName} ${count}`);

    // Small delay for the message to arrive and the lender to react
    await sleep(3000);

    // TPA to the lender bot
    this.bot.chat(`/tpa ${lender.username}`);
    const startPos = this.bot.entity.position.clone();

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { clearInterval(check); reject(new Error('TPA timeout')); }, 30000);
        const check = setInterval(() => {
          try {
            if (this.bot.entity.position.distanceTo(startPos) > 10) {
              clearInterval(check); clearTimeout(timeout); resolve();
            }
          } catch {}
        }, 1000);
      });
    } catch {
      this.log.warn('TPA to lender failed');
      return false;
    }

    this.log.info('Teleported to lender - waiting for item drop...');
    await sleep(2000);

    // Wait for item pickup (mineflayer auto-picks up nearby items)
    const beforeCount = this.countItem(itemName);
    await sleep(8000);
    const afterCount = this.countItem(itemName);

    if (afterCount > beforeCount) {
      const received = afterCount - beforeCount;
      this.log.info(`Received ${received}x ${itemName} from Bot-${lender.index}`);
      this.lendingHistory.push({
        from: lender.index, to: this.botIndex, item: itemName,
        count: received, timestamp: Date.now(),
      });
      if (this.lendingHistory.length > 100) this.lendingHistory = this.lendingHistory.slice(-100);
      return true;
    }

    this.log.warn('Did not receive item from lender');
    return false;
  }

  // Find a bot that has extras of the requested item
  findLender(itemName, count = 1, botInstances) {
    const minKeep = 1;

    for (const [idx, inst] of Object.entries(botInstances)) {
      const i = parseInt(idx);
      if (i === this.botIndex) continue;
      if (!inst.bot || !inst.bot.inventory) continue;

      const items = inst.bot.inventory.items().filter(item =>
        item.name === itemName
      );
      const total = items.reduce((s, i) => s + i.count, 0);

      if (total > minKeep) {
        return {
          index: i,
          username: inst.creds?.username || inst.bot.username,
          available: total - minKeep,
        };
      }
    }
    return null;
  }

  // Drop items for another bot to pick up
  async dropForLender(itemName, count) {
    const items = this.bot.inventory.items().filter(i => i.name === itemName);
    let dropped = 0;

    for (const item of items) {
      if (dropped >= count) break;
      try {
        const toDrop = Math.min(item.count, count - dropped);
        if (toDrop >= item.count) {
          await this.bot.tossStack(item);
        } else {
          await this.bot.toss(item.name, toDrop);
        }
        dropped += toDrop;
        await sleep(300);
      } catch {}
    }

    this.log.info(`Dropped ${dropped}x ${itemName} for borrower`);
    this.lendingHistory.push({
      from: this.botIndex, to: null, item: itemName,
      count: dropped, timestamp: Date.now(),
    });
    if (this.lendingHistory.length > 100) this.lendingHistory = this.lendingHistory.slice(-100);
    return dropped;
  }

  countItem(itemName) {
    return this.bot.inventory.items()
      .filter(i => i.name === itemName)
      .reduce((s, i) => s + i.count, 0);
  }

  hasEnough(itemName, count = 1) {
    return this.countItem(itemName) >= count;
  }

  getHistory() {
    return this.lendingHistory;
  }
}

module.exports = { ItemLending };
