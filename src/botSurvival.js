// Bot survival: health/food, anti-AFK, stuck detection, self-defense, mob/player avoidance

const { sleep } = require('./utils');
const { goals } = require('mineflayer-pathfinder');
const { AntiCaptcha } = require('./antiCaptcha');

const DANGEROUS_BLOCKS = ['lava', 'fire', 'cactus', 'sweet_berry_bush', 'wither_rose'];

// Hostile mob names (1.21.1) - mobs that attack players unprovoked
const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray', 'wither_skeleton',
  'blaze', 'ghast', 'magma_cube', 'silverfish', 'endermite', 'guardian',
  'elder_guardian', 'shulker', 'evoker', 'vindicator', 'pillager', 'ravager',
  'hoglin', 'zoglin', 'piglin_brute', 'warden', 'bogged', 'breeze',
]);

class BotSurvival {
  constructor(bot, config, log) {
    this.bot = bot;
    this.config = config.survival || {};
    this.log = log;
    this.running = true;
    this.lastPosition = null;
    this.stuckTicks = 0;
    this.stuckThreshold = this.config.stuckThresholdTicks || 30;
    this.afkTimer = null;
    this.healthMonitorInterval = null;
    this.entityMonitorInterval = null;
    this.minHealth = this.config.minHealth || 8;
    this.minFood = this.config.minFood || 12;
    this.autoEatEnabled = this.config.autoEat !== false;
    this.avoidPlayers = this.config.avoidPlayers !== false;
    this.playerAvoidRadius = this.config.playerAvoidRadius || 30;
    this.selfDefense = this.config.selfDefense !== false;
    this.isPaused = false; // Paused when threats nearby
    this.health = 20;
    this.food = 20;
    this.xp = 0;
    this.xpLevel = 0;
    this.hasCompletedFirstRtp = false;
    this.shouldLogout = false;
  }

  start() {
    this.running = true;
    this.startAntiAFK();
    this.startHealthMonitor();
    this.startEntityMonitor();
    this.setupXpListener();
    this.startAntiCaptcha();
    this.log.info('Survival systems active');
  }

  stop() {
    this.running = false;
    if (this.afkTimer) clearInterval(this.afkTimer);
    if (this.healthMonitorInterval) clearInterval(this.healthMonitorInterval);
    if (this.entityMonitorInterval) clearInterval(this.entityMonitorInterval);
    if (this.antiCaptcha) this.antiCaptcha.stop();
  }

  getHealthData() {
    return { health: this.health, food: this.food, xp: this.xp, xpLevel: this.xpLevel };
  }

  // --- Anti-AFK ---
  startAntiAFK() {
    const interval = this.config.afkIntervalMs || 240000;
    this.afkTimer = setInterval(() => {
      if (!this.running || !this.bot.entity) return;
      try {
        const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.5;
        const pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.3;
        this.bot.look(yaw, pitch);
        if (Math.random() < 0.3) this.bot.swingArm();
      } catch {}
    }, interval);
  }

  // --- Health & Food ---
  startHealthMonitor() {
    // Event-driven: react instantly to health/food changes
    this.bot.on('health', () => {
      if (!this.running || !this.bot.entity) return;
      try {
        this.health = this.bot.health || 20;
        this.food = this.bot.food || 20;

        if (this.health < 5) {
          this.log.warn(`Critical health: ${this.health}/20`);
          this.tryEat();
        } else if (this.autoEatEnabled && (this.food < this.minFood || this.health < this.minHealth)) {
          this.tryEat();
        }
      } catch {}
    });

    // Periodic fallback check every 10s in case events are missed
    this.healthMonitorInterval = setInterval(() => {
      if (!this.running || !this.bot.entity) return;
      try {
        this.health = this.bot.health || 20;
        this.food = this.bot.food || 20;
        if (this.autoEatEnabled && (this.food < this.minFood || this.health < this.minHealth)) {
          this.tryEat();
        }
      } catch {}
    }, 10000);
  }

  async tryEat() {
    try {
      const food = this.bot.inventory.items().find(i =>
        i.name.includes('cooked') || i.name.includes('bread') ||
        i.name.includes('apple') || i.name.includes('steak') ||
        i.name.includes('stew') || i.name.includes('carrot') ||
        i.name === 'golden_carrot' || i.name.includes('porkchop') ||
        i.name === 'beef' || i.name === 'mutton' || i.name === 'chicken'
      );
      if (food) {
        await this.bot.equip(food, 'hand');
        await this.bot.activateItem();
        this.log.info(`Eating ${food.name}`);
      }
    } catch (err) {
      this.log.warn(`Eat failed: ${err.message}`);
    }
  }

  // --- XP ---
  setupXpListener() {
    this.bot.on('experience', () => {
      try {
        this.xp = this.bot.experience?.progress || 0;
        this.xpLevel = this.bot.experience?.level || 0;
      } catch {}
    });
  }

  // --- Entity Monitor: Player Avoidance + Mob Flee ---
  startEntityMonitor() {
    this.entityMonitorInterval = setInterval(() => {
      if (!this.running || !this.bot.entity) return;
      try {
        const nearbyPlayers = this.getNearbyPlayers();
        const nearbyHostiles = this.getNearbyHostiles();

        // Player avoidance: logout for hours if real player detected
        if (this.avoidPlayers && nearbyPlayers.length > 0) {
          // Don't avoid if we haven't done first RTP yet (spawn = always crowded)
          if (!this.hasCompletedFirstRtp) return;

          // Filter out other bots
          const realPlayers = nearbyPlayers.filter(e => !this.isOtherBot(e));
          if (realPlayers.length > 0) {
            // Check for staff - immediate logout
            const staffPlayer = realPlayers.find(e => this.isStaffPlayer(e));
            if (staffPlayer) {
              this.log.error(`STAFF DETECTED: ${staffPlayer.username} - emergency logout`);
              const { BotCoordinator } = require('./botCoordinator');
              BotCoordinator.setStaffOnline(staffPlayer.username, true);
              this.shouldLogout = true;
              return;
            }

            this.log.warn(`Real player detected: ${realPlayers.map(e => e.username).join(', ')} - logging out`);
            this.shouldLogout = true;
            return;
          }
        }

        // Resume if no threats
        if (this.isPaused && nearbyPlayers.length === 0 && nearbyHostiles.length === 0) {
          this.isPaused = false;
          this.log.info('No threats nearby - resuming');
        }

        // Flee from hostile mobs, only fight back if cornered and critical health
        if (nearbyHostiles.length > 0) {
          const closest = nearbyHostiles[0];
          const dist = this.bot.entity.position.distanceTo(closest.position);

          if (this.health < 5 && dist < 2) {
            // Cornered and about to die - fight back
            this.attackBack(closest);
          } else if (dist < 8) {
            // Flee from mob
            if (!this.isPaused) {
              this.isPaused = true;
              this.log.info(`Hostile mob nearby (${closest.name || 'mob'}) - fleeing`);
            }
            this.fleeFrom(closest.position);
          }
        } else if (nearbyHostiles.length === 0 && nearbyPlayers.length === 0) {
          this.isPaused = false;
        }
      } catch {}
    }, 2000);
  }

  isOtherBot(entity) {
    const { BotCoordinator } = require('./botCoordinator');
    return BotCoordinator.isBotUsername(entity.username);
  }

  // Check if a player is likely server staff (admin, mod, helper)
  isStaffPlayer(entity) {
    const username = entity.username?.toLowerCase() || '';
    // Check for common staff rank prefixes in display name or tab list
    const staffKeywords = ['admin', 'owner', 'mod', 'helper', 'staff', 'developer', 'dev'];
    try {
      const player = this.bot.players[entity.username];
      if (player) {
        const displayName = player.displayName?.toString()?.toLowerCase() || '';
        for (const kw of staffKeywords) {
          if (displayName.includes(kw)) return true;
        }
      }
    } catch {}
    return false;
  }

  getNearbyPlayers() {
    return Object.values(this.bot.entities).filter(e =>
      e.type === 'player' &&
      e.username !== this.bot.username &&
      this.bot.entity.position.distanceTo(e.position) < this.playerAvoidRadius
    ).sort((a, b) =>
      this.bot.entity.position.distanceTo(a.position) - this.bot.entity.position.distanceTo(b.position)
    );
  }

  getNearbyHostiles() {
    return Object.values(this.bot.entities).filter(e => {
      if (e.type !== 'mob') return false;
      if (!HOSTILE_MOBS.has(e.name)) return false;
      return this.bot.entity.position.distanceTo(e.position) < 6;
    }).sort((a, b) =>
      this.bot.entity.position.distanceTo(a.position) - this.bot.entity.position.distanceTo(b.position)
    );
  }

  attackBack(entity) {
    try {
      const sword = this.bot.inventory.items().find(i => i.name.includes('sword'));
      if (sword) {
        this.bot.equip(sword, 'hand').catch(() => {});
      }
      this.bot.attack(entity);
    } catch {}
  }

  fleeFrom(targetPos) {
    try {
      const myPos = this.bot.entity.position;
      const dx = myPos.x - targetPos.x;
      const dz = myPos.z - targetPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1) return;

      // Run away 20 blocks in opposite direction
      const fleeX = Math.floor(myPos.x + (dx / dist) * 20);
      const fleeZ = Math.floor(myPos.z + (dz / dist) * 20);
      this.bot.pathfinder.setGoal(new goals.GoalXZ(fleeX, fleeZ));
    } catch {}
  }

  // --- Stuck Detection ---
  checkStuck() {
    if (!this.bot.entity) return false;
    const pos = this.bot.entity.position;
    if (this.lastPosition) {
      const dx = pos.x - this.lastPosition.x;
      const dz = pos.z - this.lastPosition.z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      if (moved < 0.5) {
        this.stuckTicks++;
        if (this.stuckTicks >= this.stuckThreshold) {
          this.log.warn(`Stuck detected! (${this.stuckTicks} ticks)`);
          this.stuckTicks = 0;
          return true;
        }
      } else {
        this.stuckTicks = 0;
      }
    }
    this.lastPosition = pos.clone();
    return false;
  }

  async recoverFromStuck() {
    this.log.info('Attempting stuck recovery...');
    try {
      this.bot.pathfinder.setGoal(null);
      await sleep(500);
      this.bot.setControlState('jump', true);
      this.bot.setControlState('forward', true);
      await sleep(1000);
      this.bot.clearControlStates();

      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 10;
      const tx = Math.floor(this.bot.entity.position.x + Math.cos(angle) * dist);
      const tz = Math.floor(this.bot.entity.position.z + Math.sin(angle) * dist);
      this.bot.pathfinder.setGoal(new goals.GoalXZ(tx, tz));
      await sleep(5000);
      this.bot.pathfinder.setGoal(null);
    } catch (err) {
      this.log.warn(`Stuck recovery failed: ${err.message}`);
    }
  }

  // --- Navigation Safety ---
  isSafePosition(pos) {
    if (!pos) return false;
    for (let dy = -2; dy <= 2; dy++) {
      const block = this.bot.blockAt(pos.offset(0, dy, 0));
      if (block && DANGEROUS_BLOCKS.includes(block.name)) return false;
    }
    if (pos.y < -60) return false;
    return true;
  }

  getToolDurability(item) {
    if (!item) return null;
    try {
      if (item.maxDurability && item.durabilityUsed !== undefined) {
        return item.maxDurability - item.durabilityUsed;
      }
      return null;
    } catch { return null; }
  }

  needsNewPickaxe() {
    const pickaxe = this.bot.inventory.items().find(i => i.name.includes('pickaxe'));
    if (!pickaxe) return true;
    const durability = this.getToolDurability(pickaxe);
    if (durability === null) return false;
    return durability < 10;
  }

  // --- Anti-Captcha ---
  startAntiCaptcha() {
    this.antiCaptcha = new AntiCaptcha(this.bot, this.log, {
      onDetection: (detection) => {
        // Pause the bot when non-auto captcha detected
        this.isPaused = true;
        this.log.error(`Bot paused: ${detection.type} captcha detected - needs human intervention`);
      },
    });
    this.antiCaptcha.start();
  }
}

module.exports = { BotSurvival };
