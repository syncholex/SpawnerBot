// Bot-to-bot item transfer: TPA to another bot and drop items
// Used for transferring pickaxes/totems to bots that need them, and collecting spawners from cycled bots

const { sleep } = require('./utils');
const { BotCoordinator } = require('./botCoordinator');

class ItemTransfer {
  constructor(bot, config, log, botIndex) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.botIndex = botIndex;
  }

  // TPA to another bot and drop specified items on the ground
  async transferToBot(targetBotIndex, targetBotUsername, itemNames) {
    if (this.config.coordination?.tpaBetweenBots === false) return false;

    this.log.info(`Transferring ${itemNames.join(', ')} to ${targetBotUsername} (Bot-${targetBotIndex})`);

    // Find items to transfer
    const items = this.bot.inventory.items().filter(i =>
      itemNames.some(name => i.name.includes(name))
    );

    if (items.length === 0) {
      this.log.info('No matching items to transfer');
      return false;
    }

    // TPA to target bot
    this.bot.chat(`/tpa ${targetBotUsername}`);

    // Wait for teleport
    const startPos = this.bot.entity.position.clone();
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('TPA timeout')); }, 30000);
        const check = setInterval(() => {
          try {
            if (this.bot.entity.position.distanceTo(startPos) > 10) {
              clearInterval(check); clearTimeout(timeout); resolve();
            }
          } catch {}
        }, 1000);
        const cleanup = () => clearInterval(check);
      });
    } catch {
      this.log.warn('TPA failed - canceling transfer');
      return false;
    }

    this.log.info('Teleported - dropping items...');
    await sleep(2000);

    // Drop items on the ground
    for (const item of items) {
      try {
        await this.bot.tossStack(item);
        this.log.info(`Dropped ${item.count}x ${item.name}`);
        await sleep(300);
      } catch (err) {
        this.log.warn(`Failed to drop ${item.name}: ${err.message}`);
      }
    }

    this.log.info('Transfer complete');
    return true;
  }

  // TPA to another bot and pick up items from the ground
  async collectFromBot(targetBotIndex, targetBotUsername) {
    if (this.config.coordination?.tpaBetweenBots === false) return false;

    this.log.info(`Collecting items from ${targetBotUsername} (Bot-${targetBotIndex})`);

    this.bot.chat(`/tpa ${targetBotUsername}`);

    const startPos = this.bot.entity.position.clone();
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('TPA timeout')); }, 30000);
        const check = setInterval(() => {
          try {
            if (this.bot.entity.position.distanceTo(startPos) > 10) {
              clearInterval(check); clearTimeout(timeout); resolve();
            }
          } catch {}
        }, 1000);
        const cleanup = () => clearInterval(check);
      });
    } catch {
      this.log.warn('TPA failed - canceling collection');
      return false;
    }

    // Walk near dropped items and pick them up (mineflayer auto-pickup handles this)
    this.log.info('Near target bot - waiting for item pickup...');
    await sleep(10000);

    return true;
  }

  // Drop all spawners on the ground (for collector bot to pick up)
  async dropAllSpawners() {
    const spawners = this.bot.inventory.items().filter(i => i.name === 'spawner');
    if (spawners.length === 0) return;

    this.log.info(`Dropping ${spawners.reduce((s, i) => s + i.count, 0)} spawners...`);
    for (const item of spawners) {
      try {
        await this.bot.tossStack(item);
        await sleep(300);
      } catch {}
    }
  }
}

module.exports = { ItemTransfer };
