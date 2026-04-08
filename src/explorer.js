// Explorer: Area exploration with sector-based coverage
// Manages bot movement, bot avoidance, and density-based direction bias

const { goals } = require('mineflayer-pathfinder');
const { GoalXZ } = goals;
const { sleep, sectorAngle } = require('./utils');
const { saveBotState, loadBotState } = require('./spawnerStore');

class Explorer {
  constructor(bot, config, botIndex, totalBots, log) {
    this.bot = bot;
    this.log = log;
    this.botIndex = botIndex;
    this.totalBots = totalBots;
    this.centerX = config.spawnerHunting?.searchCenterX || 0;
    this.centerZ = config.spawnerHunting?.searchCenterZ || 0;
    this.radius = config.spawnerHunting?.searchRadius || 2000;
    this.direction = sectorAngle(botIndex, totalBots);
    this.currentDistance = 0;
    this.baseStepSize = 30;
    this.exploring = false;
    this.stepCount = 0;
    this.minBotSpacing = 100;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 50;
    this.densityBias = true;
    this.densityCheckInterval = 50;
  }

  avoidOtherBots() {
    try {
      const { BotCoordinator } = require('./botCoordinator');
      const positions = BotCoordinator.getBotPositions?.() || new Map();
      const myPos = this.bot.entity?.position;
      if (!myPos) return;

      for (const [idx, pos] of positions) {
        if (parseInt(idx) === this.botIndex) continue;
        const dx = myPos.x - pos.x;
        const dz = myPos.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < this.minBotSpacing && dist > 1) {
          const angle = Math.atan2(dz, dx);
          this.direction = angle + (Math.random() - 0.5) * 0.5;
          this.currentDistance += 30;
          this.log.debug(`Nudging away from Bot-${idx} (${dist.toFixed(0)} blocks)`);
          break;
        }
      }
    } catch {}
  }

  biasTowardDenseAreas() {
    try {
      const { getAllSpawners } = require('./spawnerStore');
      const spawners = getAllSpawners();
      if (spawners.length < 10) return;

      const myPos = this.bot.entity?.position;
      if (!myPos) return;

      let bestAngle = null;
      let bestDensity = 0;

      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const checkDist = 200;
        const checkX = myPos.x + Math.cos(a) * checkDist;
        const checkZ = myPos.z + Math.sin(a) * checkDist;

        let nearbyCount = 0;
        for (const s of spawners) {
          const dx = s.x - checkX;
          const dz = s.z - checkZ;
          if (dx * dx + dz * dz < 300 * 300) nearbyCount++;
        }

        if (nearbyCount > bestDensity) {
          bestDensity = nearbyCount;
          bestAngle = a;
        }
      }

      if (bestAngle !== null && bestDensity > 3) {
        this.direction = this.direction * 0.9 + bestAngle * 0.1;
        this.log.debug(`Biasing toward spawner-dense area (density: ${bestDensity})`);
      }
    } catch {}
  }

  startExploring() {
    if (this.exploring) return;
    this.exploring = true;
    this.consecutiveErrors = 0;

    const saved = loadBotState(this.botIndex);
    if (saved && Date.now() - saved.savedAt < 30 * 60 * 1000) {
      this.direction = saved.direction ?? this.direction;
      this.currentDistance = saved.currentDistance ?? this.currentDistance;
      this.log.info(`Resumed exploration dir=${this.direction.toFixed(2)}rad dist=${this.currentDistance.toFixed(0)}`);
    } else {
      this.log.info(`Starting exploration dir=${this.direction.toFixed(2)}rad radius=${this.radius}`);
    }

    this.walkLoop();
  }

  stop() {
    this.exploring = false;
    this.bot.pathfinder.setGoal(null);
    try {
      saveBotState(this.botIndex, {
        direction: this.direction,
        currentDistance: this.currentDistance,
      });
    } catch {}
  }

  async walkLoop() {
    while (this.exploring) {
      try {
        await this.step();
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        this.log.debug(`Exploration step error (${this.consecutiveErrors}/${this.maxConsecutiveErrors}): ${err.message}`);

        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          this.log.error(`Too many exploration errors (${this.maxConsecutiveErrors}) - stopping explorer`);
          this.exploring = false;
          return;
        }

        await sleep(2000);
      }
    }
  }

  async step() {
    if (this.stepCount % 10 === 0) this.avoidOtherBots();

    if (this.densityBias && this.stepCount > 0 && this.stepCount % this.densityCheckInterval === 0) {
      this.biasTowardDenseAreas();
    }

    const stepSize = this.baseStepSize + (Math.random() - 0.5) * 20;
    this.currentDistance += stepSize;

    if (this.currentDistance > this.radius) {
      this.currentDistance = 0;
      this.direction += (Math.PI * 2) / (this.totalBots || 1);
    }

    const targetX = Math.floor(this.centerX + Math.cos(this.direction) * this.currentDistance);
    const targetZ = Math.floor(this.centerZ + Math.sin(this.direction) * this.currentDistance);

    await this.moveToXZ(targetX, targetZ);

    this.direction += (Math.PI * 2) / 36 + (Math.random() - 0.5) * 0.1;

    this.stepCount++;
    if (this.stepCount % (5 + Math.floor(Math.random() * 10)) === 0) {
      const pauseTime = 1000 + Math.random() * 4000;
      this.log.debug(`Pausing for ${(pauseTime / 1000).toFixed(1)}s`);
      await sleep(pauseTime);
    }

    if (Math.random() < 0.1) {
      try {
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * 0.8;
        await this.bot.look(yaw, pitch);
      } catch {}
    }
  }

  moveToXZ(x, z) {
    const goal = new GoalXZ(x, z);
    this.bot.pathfinder.setGoal(goal);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        this.bot.pathfinder.setGoal(null);
        resolve();
      }, 45000);

      const onReached = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); resolve(); };
      const onStop = () => { cleanup(); resolve(); };

      const cleanup = () => {
        clearTimeout(timeout);
        this.bot.removeListener('goal_reached', onReached);
        this.bot.removeListener('path_error', onError);
        this.bot.removeListener('path_stop', onStop);
      };

      this.bot.once('goal_reached', onReached);
      this.bot.once('path_error', onError);
      this.bot.once('path_stop', onStop);
    });
  }
}

module.exports = { Explorer };
