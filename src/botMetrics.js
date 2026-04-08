// Bot performance metrics: tracks spawners/hr, distance/hr, deaths, efficiency per bot

const { getStats } = require('./spawnerStore');

class BotMetrics {
  constructor() {
    this.metrics = new Map(); // botIndex -> metrics object
    this.globalSnapshots = []; // hourly snapshots for dashboard
  }

  init(botIndex) {
    this.metrics.set(botIndex, {
      startTime: Date.now(),
      spawnersFound: 0,
      spawnersMined: 0,
      spawnersFailed: 0,
      deaths: 0,
      distanceTraveled: 0,
      lastPosition: null,
      lastPositionTime: Date.now(),
      commandsExecuted: 0,
      purchases: 0,
      moneySpent: 0,
      itemsSold: 0,
      moneyEarned: 0,
      chunksExplored: 0,
      rtpCount: 0,
      dailyClaims: 0,
      cycles: 0,
      transfers: 0,
      captchaDetections: 0,
      playerAvoidances: 0,
    });
  }

  recordFound(botIndex, count = 1) {
    const m = this.metrics.get(botIndex);
    if (m) m.spawnersFound += count;
  }

  recordMined(botIndex, count = 1) {
    const m = this.metrics.get(botIndex);
    if (m) m.spawnersMined += count;
  }

  recordFailed(botIndex, count = 1) {
    const m = this.metrics.get(botIndex);
    if (m) m.spawnersFailed += count;
  }

  recordDeath(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.deaths++;
  }

  recordDistance(botIndex, pos) {
    const m = this.metrics.get(botIndex);
    if (!m || !pos) return;
    if (m.lastPosition) {
      const dx = pos.x - m.lastPosition.x;
      const dz = pos.z - m.lastPosition.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Only count meaningful movement (> 1 block)
      if (dist > 1) m.distanceTraveled += dist;
    }
    m.lastPosition = { x: pos.x, y: pos.y, z: pos.z };
    m.lastPositionTime = Date.now();
  }

  recordCommand(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.commandsExecuted++;
  }

  recordPurchase(botIndex, cost) {
    const m = this.metrics.get(botIndex);
    if (m) { m.purchases++; m.moneySpent += cost; }
  }

  recordSale(botIndex, earned) {
    const m = this.metrics.get(botIndex);
    if (m) { m.itemsSold++; m.moneyEarned += earned; }
  }

  recordRtp(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.rtpCount++;
  }

  recordDaily(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.dailyClaims++;
  }

  recordCycle(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.cycles++;
  }

  recordTransfer(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.transfers++;
  }

  recordCaptcha(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.captchaDetections++;
  }

  recordPlayerAvoidance(botIndex) {
    const m = this.metrics.get(botIndex);
    if (m) m.playerAvoidances++;
  }

  remove(botIndex) {
    this.metrics.delete(botIndex);
  }

  getMetrics(botIndex) {
    const m = this.metrics.get(botIndex);
    if (!m) return null;
    const elapsed = (Date.now() - m.startTime) / 1000;
    const hours = Math.max(elapsed / 3600, 0.01);
    return {
      ...m,
      uptime: elapsed,
      spawnersPerHour: +(m.spawnersMined / hours).toFixed(1),
      foundPerHour: +(m.spawnersFound / hours).toFixed(1),
      distancePerHour: +(m.distanceTraveled / hours).toFixed(0),
      deathRate: +(m.deaths / hours).toFixed(2),
      efficiency: m.spawnersFound > 0 ? +((m.spawnersMined / m.spawnersFound) * 100).toFixed(1) : 0,
      commandsPerMinute: +((m.commandsExecuted / elapsed) * 60).toFixed(1),
    };
  }

  getAllMetrics() {
    const result = {};
    for (const [idx] of this.metrics) {
      result[idx] = this.getMetrics(idx);
    }
    return result;
  }

  getSpawnersPerHour(botIndex) {
    const m = this.metrics.get(botIndex);
    if (!m) return 0;
    const hours = Math.max((Date.now() - m.startTime) / 3600000, 0.01);
    return +(m.spawnersMined / hours).toFixed(1);
  }

  // Take a global snapshot for time-series charting
  takeSnapshot() {
    const allMetrics = {};
    let totalMined = 0, totalFound = 0, totalDistance = 0, totalDeaths = 0;
    for (const [idx] of this.metrics) {
      const m = this.getMetrics(idx);
      if (m) {
        allMetrics[idx] = m;
        totalMined += m.spawnersMined;
        totalFound += m.spawnersFound;
        totalDistance += m.distanceTraveled;
        totalDeaths += m.deaths;
      }
    }
    const snapshot = {
      t: Date.now(),
      totalMined,
      totalFound,
      totalDistance,
      totalDeaths,
      botsActive: this.metrics.size,
      perBot: allMetrics,
    };
    this.globalSnapshots.push(snapshot);
    if (this.globalSnapshots.length > 1440) this.globalSnapshots.splice(0, this.globalSnapshots.length - 1440);
    return snapshot;
  }

  getSnapshots() {
    return this.globalSnapshots;
  }

  // Get leaderboard sorted by a metric
  getLeaderboard(metric = 'spawnersPerHour', limit = 10) {
    return [...this.metrics.entries()]
      .map(([idx]) => ({ index: idx, ...this.getMetrics(idx) }))
      .filter(m => m.uptime > 60) // Only bots with > 1 min uptime
      .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
      .slice(0, limit);
  }
}

// Singleton
const metrics = new BotMetrics();
module.exports = { BotMetrics, metrics };
