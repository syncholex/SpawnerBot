// Command Rate Limiter: Queues chat commands with configurable rate limits
// Prevents kicks from spamming commands too fast on anti-bot servers

const { sleep } = require('./utils');

class CommandQueue {
  constructor(bot, log, config = {}) {
    this.bot = bot;
    this.log = log;
    this.minInterval = config.minIntervalMs || 1000;  // Min ms between commands
    this.burstAllowance = config.burstAllowance || 3;  // Allow N rapid commands before throttling
    this.burstWindow = config.burstWindowMs || 5000;   // Window for burst detection
    this.queue = [];
    this.lastSentAt = 0;
    this.recentSends = [];       // Timestamps of recent sends for burst tracking
    this.slowedDown = false;     // True if server told us to slow down
    this.processing = false;
  }

  // Queue a command for rate-limited sending
  queueCommand(command, priority = false) {
    return new Promise((resolve, reject) => {
      const entry = { command, resolve, reject };
      if (priority) {
        this.queue.unshift(entry);
      } else {
        this.queue.push(entry);
      }
      this.process();
    });
  }

  // Send immediately if rate allows, otherwise queue
  async send(command) {
    return this.queueCommand(command);
  }

  // Send without waiting for response
  sendNow(command) {
    this.queueCommand(command).catch(() => {});
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      try {
        // Skip if bot is no longer connected
        if (!this.bot.entity) {
          entry.reject(new Error('Bot not connected'));
          continue;
        }
        await this.throttle();
        this.bot.chat(entry.command);
        this.recordSend();
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      }
    }

    this.processing = false;
  }

  // Wait until it's safe to send
  async throttle() {
    // If server told us to slow down, wait extra
    if (this.slowedDown) {
      this.log.info('Rate limiter: extra delay (server slow-down detected)');
      await sleep(5000);
      this.slowedDown = false;
    }

    // Check burst window
    const now = Date.now();
    this.recentSends = this.recentSends.filter(t => now - t < this.burstWindow);

    if (this.recentSends.length >= this.burstAllowance) {
      // Burst limit reached - wait until window clears
      const oldestInWindow = this.recentSends[0];
      const waitMs = this.burstWindow - (now - oldestInWindow) + 100;
      if (waitMs > 0) {
        this.log.debug(`Rate limiter: burst cooldown ${waitMs}ms`);
        await sleep(waitMs);
      }
    }

    // Enforce minimum interval
    const elapsed = Date.now() - this.lastSentAt;
    if (elapsed < this.minInterval) {
      await sleep(this.minInterval - elapsed);
    }
  }

  recordSend() {
    this.lastSentAt = Date.now();
    this.recentSends.push(this.lastSentAt);
  }

  // Call when server sends a "slow down" or "wait" message
  notifySlowdown() {
    this.slowedDown = true;
    this.log.warn('Server requested slow-down - increasing command delays');
  }

  // Get queue stats
  getStats() {
    return {
      queueLength: this.queue.length,
      lastSentAt: this.lastSentAt,
      recentCount: this.recentSends.length,
      slowedDown: this.slowedDown,
    };
  }
}

module.exports = { CommandQueue };
