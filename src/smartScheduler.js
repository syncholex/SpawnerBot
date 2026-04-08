// Smart scheduling: analyzes player/staff activity patterns to optimize hunting times
// Learns when the server is safest and adjusts bot intensity

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.resolve(__dirname, '..', 'data');
const SCHEDULER_FILE = path.join(STATE_DIR, 'schedulerState.json');

class SmartScheduler {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    // Per-hour activity data: { samples, avgPlayers, maxPlayers, staffSightings, lastSeen }
    this.hourlyActivity = new Array(24).fill(null).map(() => ({
      samples: 0, avgPlayers: 0, maxPlayers: 0, staffSightings: 0, lastSeen: 0,
    }));
    this.currentRisk = 'normal'; // 'safe', 'normal', 'cautious', 'dangerous'
    this.lastActivityUpdate = 0;
  }

  // Record current server activity for the current hour
  recordActivity(playerCount, staffOnline) {
    const hour = new Date().getHours();
    const data = this.hourlyActivity[hour];

    // Running average
    data.avgPlayers = (data.avgPlayers * data.samples + playerCount) / (data.samples + 1);
    data.maxPlayers = Math.max(data.maxPlayers, playerCount);
    data.lastSeen = Date.now();
    if (staffOnline > 0) data.staffSightings++;
    data.samples++;

    // Update current risk level
    this.updateRiskLevel(playerCount, staffOnline);
    this.lastActivityUpdate = Date.now();
  }

  updateRiskLevel(playerCount, staffOnline) {
    if (staffOnline > 0) {
      this.currentRisk = 'dangerous';
    } else if (playerCount >= 20) {
      this.currentRisk = 'cautious';
    } else if (playerCount <= 5) {
      this.currentRisk = 'safe';
    } else {
      this.currentRisk = 'normal';
    }
  }

  // Get hours ranked by safety (lowest activity first)
  getOptimalHours() {
    return this.hourlyActivity
      .map((data, hour) => ({
        hour,
        safetyScore: data.samples > 0
          ? (100 - Math.min(data.avgPlayers * 2, 80) - data.staffSightings * 10)
          : 50, // Default 50 if no data
        avgPlayers: data.avgPlayers,
        staffSightings: data.staffSightings,
        samples: data.samples,
      }))
      .sort((a, b) => b.safetyScore - a.safetyScore);
  }

  // Should we hunt right now?
  shouldHuntNow() {
    return this.currentRisk !== 'dangerous';
  }

  // Get recommended bot intensity (0-1 scale)
  getRecommendedIntensity() {
    switch (this.currentRisk) {
      case 'safe': return 1.0;
      case 'normal': return 0.8;
      case 'cautious': return 0.5;
      case 'dangerous': return 0.1;
      default: return 0.8;
    }
  }

  // Get forecast for next few hours
  getActivityForecast(hours = 6) {
    const now = new Date().getHours();
    const forecast = [];
    for (let i = 0; i < hours; i++) {
      const hour = (now + i) % 24;
      const data = this.hourlyActivity[hour];
      forecast.push({
        hour,
        avgPlayers: data.samples > 0 ? +data.avgPlayers.toFixed(1) : null,
        staffRisk: data.staffSightings > 0,
        safetyScore: data.samples > 0
          ? +(100 - Math.min(data.avgPlayers * 2, 80) - data.staffSightings * 10).toFixed(0)
          : 50,
      });
    }
    return forecast;
  }

  // Get current risk assessment
  getRiskAssessment() {
    return {
      currentRisk: this.currentRisk,
      intensity: this.getRecommendedIntensity(),
      optimalHours: this.getOptimalHours().slice(0, 5),
      forecast: this.getActivityForecast(),
      lastUpdate: this.lastActivityUpdate,
      hourlyData: this.hourlyActivity.map((d, h) => ({
        hour: h, ...d, avgPlayers: +d.avgPlayers.toFixed(1),
      })),
    };
  }

  // Adjust bot behavior parameters based on risk
  getAdjustedParams() {
    const intensity = this.getRecommendedIntensity();
    return {
      // Scale exploration tick speed
      explorationTickMs: Math.round((this.config.spawnerHunting?.explorationTickMs || 1000) / intensity),
      // Scale anti-AFK interval (more cautious = less frequent actions)
      afkIntervalMs: Math.round((this.config.survival?.afkIntervalMs || 240000) / intensity),
      // Whether to enable player avoidance at a wider radius
      playerAvoidRadius: this.currentRisk === 'dangerous' ? 60 : (this.config.survival?.playerAvoidRadius || 30),
      // Whether to skip non-essential activities (shopping, daily, etc.)
      skipNonEssential: this.currentRisk === 'dangerous' || this.currentRisk === 'cautious',
    };
  }

  // Persistence
  saveState() {
    try {
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(SCHEDULER_FILE, JSON.stringify({
        hourlyActivity: this.hourlyActivity,
        savedAt: Date.now(),
      }, null, 2));
    } catch {}
  }

  loadState() {
    try {
      if (fs.existsSync(SCHEDULER_FILE)) {
        const data = JSON.parse(fs.readFileSync(SCHEDULER_FILE, 'utf-8'));
        if (data.hourlyActivity) {
          for (let i = 0; i < 24; i++) {
            if (data.hourlyActivity[i]) {
              this.hourlyActivity[i] = { ...this.hourlyActivity[i], ...data.hourlyActivity[i] };
            }
          }
        }
        this.log.info('Smart scheduler state loaded');
      }
    } catch {}
  }
}

module.exports = { SmartScheduler };
