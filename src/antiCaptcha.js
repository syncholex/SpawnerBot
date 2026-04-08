// Anti-Captcha Detection: Monitors chat for bot-detection challenges
// Pauses the bot and alerts via Discord webhook when detected

const { sleep } = require('./utils');

// Known captcha/anti-bot patterns across common plugins
const CAPTCHA_PATTERNS = [
  // Chat-based captcha
  { pattern: /type\s+(?:the\s+)?(?:word|code|number)\s*[:\-]?\s*['"]?(\w+)['"]?/i, type: 'text_captcha', hasAnswer: true },
  { pattern: /please\s+type\s+['"]?(\w+)['"]?\s+to\s+(?:continue|verify|prove)/i, type: 'text_captcha', hasAnswer: true },
  { pattern: /enter\s+['"]?(\w+)['"]?\s+in\s+chat/i, type: 'text_captcha', hasAnswer: true },
  { pattern: /captcha/i, type: 'captcha', hasAnswer: false },
  { pattern: /verification\s+(?:code|required|failed)/i, type: 'verification', hasAnswer: false },
  { pattern: /prove\s+you(?:'re| are)\s+(?:not|human)/i, type: 'human_check', hasAnswer: false },
  { pattern: /anti[\-_]?bot/i, type: 'anti_bot', hasAnswer: false },
  { pattern: /automated\s+(?:action|bot|player)/i, type: 'bot_detected', hasAnswer: false },
  { pattern: /click\s+(?:here|the\s+button|on\s+the)/i, type: 'click_captcha', hasAnswer: false },
  { pattern: /slider/i, type: 'slider_captcha', hasAnswer: false },
  // ClickVerify / similar plugins
  { pattern: /you\s+have\s+\d+\s+seconds?\s+to/i, type: 'timed_challenge', hasAnswer: false },
  { pattern: /please\s+(?:solve|complete)\s+(?:this|the)/i, type: 'challenge', hasAnswer: false },
  // Mute/warning patterns that suggest bot detection
  { pattern: /you\s+are\s+sending\s+(?:commands|messages)\s+too\s+fast/i, type: 'rate_limit', hasAnswer: false },
  { pattern: /suspected\s+(?:bot|cheat|hack)/i, type: 'suspected', hasAnswer: false },
];

class AntiCaptcha {
  constructor(bot, log, config = {}) {
    this.bot = bot;
    this.log = log;
    this.config = config;
    this.paused = false;
    this.detected = false;
    this.detectionCount = 0;
    this.onDetection = config.onDetection || null; // Callback: (detection) => void
    this.autoRespond = config.autoRespond !== false;
  }

  start() {
    this._handler = (jsonMsg) => { this.checkMessage(jsonMsg); };
    this.bot.on('message', this._handler);
    this.log.info('Anti-captcha detection active');
  }

  stop() {
    this.paused = true;
    if (this._handler) {
      this.bot.removeListener('message', this._handler);
      this._handler = null;
    }
  }

  checkMessage(jsonMsg) {
    if (this.paused) return;

    const text = jsonMsg.toString();
    // Skip our own messages
    if (text.startsWith('<') || text.startsWith('*')) return;

    for (const rule of CAPTCHA_PATTERNS) {
      const match = text.match(rule.pattern);
      if (match) {
        const detection = {
          type: rule.type,
          text: text,
          answer: rule.hasAnswer && match[1] ? match[1] : null,
          timestamp: Date.now(),
        };

        this.handleDetection(detection);
        return; // Only handle first match
      }
    }
  }

  handleDetection(detection) {
    this.detected = true;
    this.detectionCount++;
    this.log.warn(`ANTI-BOT DETECTED: ${detection.type} - "${detection.text}"`);

    // Auto-respond to simple text captchas
    if (detection.answer && this.autoRespond) {
      this.log.info(`Auto-responding to captcha with: ${detection.answer}`);
      try {
        this.bot.chat(detection.answer);
      } catch {}
      return;
    }

    // For non-auto captcha types, pause and alert
    this.paused = true;

    if (this.onDetection) {
      this.onDetection(detection);
    }
  }

  // Resume after human intervention
  resume() {
    this.paused = false;
    this.detected = false;
    this.log.info('Anti-captcha resumed - bot active again');
  }

  isPaused() {
    return this.paused;
  }

  getStats() {
    return {
      active: !this.paused,
      detections: this.detectionCount,
      lastType: this.detected ? 'active' : 'none',
    };
  }
}

module.exports = { AntiCaptcha, CAPTCHA_PATTERNS };
