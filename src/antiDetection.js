// Anti-detection: humanizes bot behavior to reduce detection risk
// Provides varied timing, movement patterns, and social behaviors

class AntiDetection {
  constructor(bot, log, config = {}) {
    this.bot = bot;
    this.log = log;
    this.config = config;
    this.recentClicks = [];
    this.socialTimer = null;
    this.running = false;
  }

  start() {
    this.running = true;
    this.startSocialBehavior();
    this.log.info('Anti-detection active');
  }

  stop() {
    this.running = false;
    if (this.socialTimer) clearInterval(this.socialTimer);
  }

  // --- Click Timing ---
  // Returns a human-like delay in ms for GUI interactions
  getHumanClickDelay() {
    // Base 400ms with variance: sometimes fast, sometimes slow
    const base = 400;
    const variance = 300;
    const delay = base + (Math.random() - 0.3) * variance;
    // Occasional "distraction" pause (5% chance)
    if (Math.random() < 0.05) return delay + 1000 + Math.random() * 2000;
    return Math.max(150, delay);
  }

  // Returns a human-like delay for chat commands
  getHumanCommandDelay() {
    const base = 800;
    const variance = 600;
    return Math.max(400, base + (Math.random() - 0.3) * variance);
  }

  // Returns a human-like walking speed modifier (0.7 - 1.3)
  getHumanWalkSpeed() {
    return 0.7 + Math.random() * 0.6;
  }

  // --- Human-like GUI Interaction ---
  // Click a slot with human-like timing
  async humanClick(slot, button = 0, actionLog = null) {
    const delay = this.getHumanClickDelay();
    if (actionLog) this.log.debug(`Clicking slot ${slot} (delay: ${delay.toFixed(0)}ms)`);

    // Small pre-click hesitation
    if (Math.random() < 0.15) {
      await this.randomMicroPause();
    }

    await this.bot.clickWindow(slot, button, 0);
    this.recentClicks.push({ slot, time: Date.now() });
    if (this.recentClicks.length > 50) this.recentClicks.shift();

    await this.sleep(delay);
  }

  // Execute a sequence of clicks with human timing
  async humanClickSequence(slots) {
    for (const slot of slots) {
      if (!this.running) break;
      await this.humanClick(slot);
    }
  }

  // --- Human-like Movement ---
  // Add variance to pathfinding goal distance
  getVaryingGoalDistance(baseDistance) {
    return baseDistance + (Math.random() - 0.5) * 6;
  }

  // Occasional micro-pause (simulates looking around, thinking)
  async randomMicroPause() {
    const pause = 200 + Math.random() * 800;
    await this.sleep(pause);
  }

  // Random "look around" behavior
  async randomLookAround() {
    try {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.4;
      await this.bot.look(yaw, pitch);
    } catch {}
  }

  // Simulate examining an item in hand
  async examineHand() {
    try {
      // Swap to offhand and back
      await this.sleep(300 + Math.random() * 500);
    } catch {}
  }

  // --- Social Behaviors ---
  startSocialBehavior() {
    if (!this.config.socialBehaviors) return;
    // Random interval: 10-30 minutes
    const interval = (10 + Math.random() * 20) * 60 * 1000;

    this.socialTimer = setInterval(() => {
      if (!this.running) return;
      this.doRandomSocialBehavior();
    }, interval);
  }

  async doRandomSocialBehavior() {
    const behaviors = [
      () => this.randomLookAround(),
      () => this.bot.swingArm(),
      () => this.bot.setControlState('sneak', true),
      () => this.randomLookAround(),
    ];

    const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
    try {
      await behavior();
      // Sneak for a moment then stop
      if (behavior.toString().includes('sneak')) {
        await this.sleep(1000 + Math.random() * 2000);
        this.bot.clearControlStates();
      }
    } catch {}
  }

  // --- Pattern Analysis ---
  // Check if recent click pattern looks too robotic
  analyzeClickPattern() {
    if (this.recentClicks.length < 5) return 'insufficient_data';

    const intervals = [];
    for (let i = 1; i < this.recentClicks.length; i++) {
      intervals.push(this.recentClicks[i].time - this.recentClicks[i - 1].time);
    }

    const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // If standard deviation is very low, pattern is too regular
    if (stdDev < 50) return 'too_regular';
    if (stdDev > 500) return 'natural';
    return 'acceptable';
  }

  // --- Utility ---
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      clicksTracked: this.recentClicks.length,
      patternQuality: this.analyzeClickPattern(),
      running: this.running,
    };
  }
}

module.exports = { AntiDetection };
