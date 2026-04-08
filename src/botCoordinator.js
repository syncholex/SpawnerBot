// Bot coordination: cooldowns, failure monitoring, TPA between bots
// Shared event bus for inter-bot communication

const EventEmitter = require('events');

const globalState = {
  dailyCooldowns: new Map(),
  rtpCooldowns: new Map(),
  failureCounts: new Map(),
  botPositions: new Map(),
  pendingTpa: new Map(),
  botUsernames: new Set(),
  staffOnline: new Set(),
};

// Shared event bus for inter-bot messaging
const botEvents = new EventEmitter();
botEvents.setMaxListeners(100);

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RTP_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;

class BotCoordinator {
  constructor(botIndex, config, log, bot) {
    this.botIndex = botIndex;
    this.bot = bot;
    this.config = config.coordination || {};
    this.log = log;

    if (this.bot) {
      this.bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString().toLowerCase();
        // Detect incoming TPA
        const tpaMatch = text.match(/bot[_-]?(\d+).*request.*teleport/);
        if (tpaMatch) {
          const fromBot = parseInt(tpaMatch[1]);
          if (this.config.tpaBetweenBots !== false) {
            this.log.info(`TPA request from Bot-${fromBot}, accepting...`);
            setTimeout(() => {
              try { this.bot.chat('/tpaccept'); } catch {}
            }, 1000 + Math.random() * 2000);
          }
        }

        // Listen for bot-to-bot messages (used for item lending triggers)
        const lendMatch = text.match(/\[bot-msg\]\s*(\w+)\s+(.+)/);
        if (lendMatch) {
          botEvents.emit('bot-message', {
            from: lendMatch[1],
            to: this.bot.username,
            body: lendMatch[2],
            botIndex: this.botIndex,
          });
        }
      });
    }
  }

  // --- TPA ---
  async requestTpa(targetBotIndex, targetBotUsername) {
    if (this.config.tpaBetweenBots === false) return false;
    if (!this.bot) return false;

    const positions = new Map(globalState.botPositions || []);
    const targetPos = positions.get(targetBotIndex);
    if (!targetPos || Date.now() - targetPos.timestamp > 30000) {
      this.log.warn(`Bot-${targetBotIndex} not seen recently, skipping TPA`);
      return false;
    }

    this.log.info(`Requesting TPA to ${targetBotUsername} (Bot-${targetBotIndex})`);
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
      this.log.info(`TPA to Bot-${targetBotIndex} successful`);
      return true;
    } catch {
      this.log.warn(`TPA to Bot-${targetBotIndex} failed`);
      return false;
    }
  }

  // Send a message to another bot via in-game /msg
  sendBotMessage(targetUsername, body) {
    if (!this.bot) return;
    try {
      this.bot.chat(`/msg ${targetUsername} [bot-msg] ${this.bot.username} ${body}`);
    } catch {}
  }

  // --- Daily Cooldown ---
  canClaimDaily() {
    const lastClaim = globalState.dailyCooldowns.get(this.botIndex);
    if (!lastClaim) return true;
    return Date.now() - lastClaim >= DAILY_COOLDOWN_MS;
  }

  markDailyClaimed() {
    globalState.dailyCooldowns.set(this.botIndex, Date.now());
    this.log.info('Daily cooldown set (24h)');
  }

  getDailyCooldownRemaining() {
    const lastClaim = globalState.dailyCooldowns.get(this.botIndex);
    if (!lastClaim) return 0;
    return Math.max(0, DAILY_COOLDOWN_MS - (Date.now() - lastClaim));
  }

  // --- RTP Cooldown ---
  canRtp() {
    const lastRtp = globalState.rtpCooldowns.get(this.botIndex);
    if (!lastRtp) return true;
    return Date.now() - lastRtp >= RTP_COOLDOWN_MS;
  }

  markRtpUsed() {
    globalState.rtpCooldowns.set(this.botIndex, Date.now());
  }

  getRtpCooldownRemaining() {
    const lastRtp = globalState.rtpCooldowns.get(this.botIndex);
    if (!lastRtp) return 0;
    return Math.max(0, RTP_COOLDOWN_MS - (Date.now() - lastRtp));
  }

  // --- Failure Monitoring ---
  recordFailure() {
    const count = (globalState.failureCounts.get(this.botIndex) || 0) + 1;
    globalState.failureCounts.set(this.botIndex, count);
    return count >= MAX_FAILURES;
  }

  recordSuccess() {
    globalState.failureCounts.set(this.botIndex, 0);
  }

  getFailureCount() {
    return globalState.failureCounts.get(this.botIndex) || 0;
  }

  // --- Position Tracking ---
  updatePosition(x, z) {
    globalState.botPositions.set(this.botIndex, { x, z, timestamp: Date.now() });
  }

  static registerBotUsername(username) {
    if (username) globalState.botUsernames.add(username.toLowerCase());
  }

  static unregisterBotUsername(username) {
    if (username) globalState.botUsernames.delete(username.toLowerCase());
  }

  static isBotUsername(username) {
    return globalState.botUsernames.has((username || '').toLowerCase());
  }

  static setStaffOnline(username, online) {
    if (online) globalState.staffOnline.add(username.toLowerCase());
    else globalState.staffOnline.delete(username.toLowerCase());
  }

  static isStaffOnline() {
    return globalState.staffOnline.size > 0;
  }

  static getOnlineStaff() {
    return [...globalState.staffOnline];
  }

  static getBotPositions() {
    return new Map(globalState.botPositions);
  }

  // --- Cleanup ---
  cleanup() {
    globalState.botPositions.delete(this.botIndex);
  }

  static getCooldowns() {
    return {
      daily: Object.fromEntries(globalState.dailyCooldowns),
      rtp: Object.fromEntries(globalState.rtpCooldowns),
    };
  }
}

module.exports = { BotCoordinator, globalState, botEvents };
