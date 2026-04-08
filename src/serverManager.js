// Server Manager: Drives startup/death/recovery sequences via server profiles
// Falls back to hardcoded behavior if no profile loaded

const { sleep, waitForWindow, waitForChat } = require('./utils');
const { Economy } = require('./economy');
const { SmartInventory } = require('./smartInventory');
const { ShopExplorer } = require('./shopExplorer');
const { ScriptEngine } = require('./scriptEngine');
const { CommandQueue } = require('./commandQueue');
const { saveShopMap, loadShopMap } = require('./spawnerStore');

class ServerManager {
  constructor(bot, config, log, profile) {
    this.bot = bot;
    this.config = config;
    this.log = log;
    this.profile = profile || null;
    this.state = 'IDLE';
    this.economy = null;
    this.smartInventory = null;
    this.shopExplorer = null;
    this.scriptEngine = null;
    this.commandQueue = null;
    this.lastRtpAttempt = 0;
    this.homeSet = false;
  }

  async initialize() {
    try {
      // Initialize command rate limiter
      this.commandQueue = new CommandQueue(this.bot, this.log, {
        minIntervalMs: this.config.delays?.commandIntervalMs || 1000,
        burstAllowance: 3,
      });

      // Detect server slow-down messages
      this.bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString().toLowerCase();
        if (text.includes('slow down') || text.includes('wait before') ||
            text.includes('too fast') || text.includes('spam') ||
            text.includes('command cooldown')) {
          this.commandQueue.notifySlowdown();
        }
      });

      // Initialize script engine
      this.scriptEngine = new ScriptEngine(this.bot, this.log);
      this.scriptEngine.setVar('password', this.config.server?.password || '');

      if (this.profile) {
        await this.initializeWithProfile();
      } else {
        await this.initializeHardcoded();
      }

      // Initialize economy and smart inventory
      this.economy = new Economy(this.bot, this.config, this.log);
      this.economy.setupBalanceListener();
      this.smartInventory = new SmartInventory(this.bot, this.log, this.economy);

      // Explore shop if profile says so
      this.shopExplorer = new ShopExplorer(this.bot, this.config, this.log);
      const shopConfig = this.getShopConfig();
      if (shopConfig.auto_explore) {
        this.log.info('Auto-exploring shop...');
        const shopMap = await this.shopExplorer.explore(shopConfig.open_command);
        if (shopMap) {
          this.log.info(`Shop mapped: ${Object.keys(shopMap.categories).length} categories found`);
          this.economy.setShopExplorer(this.shopExplorer);
          // Persist shop map for restart recovery
          saveShopMap(shopMap);
        } else {
          // Try loading previously saved shop map
          const savedMap = loadShopMap();
          if (savedMap && savedMap.flatItems?.length > 0) {
            this.log.info(`Loaded saved shop map: ${savedMap.flatItems.length} items`);
            this.shopExplorer.loadShopMap(savedMap);
            this.economy.setShopExplorer(this.shopExplorer);
          }
        }
      } else {
        // Even without auto_explore, try loading a saved map
        const savedMap = loadShopMap();
        if (savedMap && savedMap.flatItems?.length > 0) {
          this.shopExplorer.loadShopMap(savedMap);
          this.economy.setShopExplorer(this.shopExplorer);
          this.log.info(`Loaded saved shop map: ${savedMap.flatItems.length} items`);
        }
      }

      await this.doInitialShopping();

      this.state = 'READY';
      this.log.info('Server initialization complete - ready to hunt');
      return { economy: this.economy, smartInventory: this.smartInventory, shopExplorer: this.shopExplorer };
    } catch (err) {
      this.log.error(`Server initialization failed at state ${this.state}: ${err.message}`);
      throw err;
    }
  }

  // --- Profile-driven initialization ---
  async initializeWithProfile() {
    const p = this.profile;
    this.log.info(`Using server profile: ${p.name || 'unnamed'}`);

    // Login or register
    await this.handleLoginRegister();

    // Run startup sequence
    if (p.startup_sequence && p.startup_sequence.length > 0) {
      this.log.info('Running startup sequence from profile...');
      await this.scriptEngine.runSequence(p.startup_sequence);
    } else {
      // Fallback to hardcoded
      await this.queueLifesteal();
      await this.rtp();
      await this.setHome();
      await this.applySettings();
      await this.claimDaily();
    }

    this.homeSet = true;
  }

  // --- Hardcoded fallback initialization ---
  async initializeHardcoded() {
    this.log.info('No server profile loaded - using hardcoded sequences');
    await this.loginOrRegister();
    await this.queueLifesteal();
    await this.rtp();
    await this.setHome();
    await this.applySettings();
    await this.claimDaily();
    this.homeSet = true;
  }

  // --- Login/Register (unified) ---
  async handleLoginRegister() {
    if (!this.profile) return this.loginOrRegister();

    const loginCfg = this.profile.login || {};
    const registerCfg = this.profile.register || {};
    const password = this.config.server?.password || '';
    this.scriptEngine.setVar('password', password);

    this.state = 'LOGIN';
    this.log.info('Waiting for login/register prompt...');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Login/register timeout'));
      }, 30000);

      let loggedIn = false;

      const onMsg = (jsonMsg) => {
        if (loggedIn) return;
        const text = jsonMsg.toString().toLowerCase();

        // Check register pattern first (some servers require register before login)
        const regPatterns = (registerCfg.detect_pattern || '').split('|');
        const loginPatterns = (loginCfg.detect_pattern || '').split('|');

        if (regPatterns.some(p => p && text.includes(p.toLowerCase()))) {
          const cmd = (registerCfg.command || '/r {password} {password}').replace(/\{password\}/g, password);
          this.bot.chat(cmd);
          this.log.info('Sent register command');
        } else if (loginPatterns.some(p => p && text.includes(p.toLowerCase()))) {
          const cmd = (loginCfg.command || '/l {password}').replace(/\{password\}/g, password);
          this.bot.chat(cmd);
          this.log.info('Sent login command');
        }

        // Detect success
        const successPatterns = [
          ...(loginCfg.success_pattern || '').split('|'),
          ...(registerCfg.success_pattern || '').split('|'),
        ].filter(p => p);

        if (successPatterns.some(p => text.includes(p.toLowerCase()))) {
          loggedIn = true;
          cleanup();
          this.log.info('Login successful');
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.bot.removeListener('message', onMsg);
      };

      this.bot.on('message', onMsg);

      // Proactive login after delay
      const proactiveDelay = loginCfg.proactive_delay_ms || 3000;
      setTimeout(() => {
        if (!loggedIn) {
          const cmd = (loginCfg.command || '/l {password}').replace(/\{password\}/g, password);
          this.bot.chat(cmd);
        }
      }, proactiveDelay);
    });
  }

  // --- Legacy login/register (hardcoded fallback) ---
  async loginOrRegister() {
    this.state = 'LOGIN';
    this.log.info('Waiting for login/register prompt...');
    const password = this.config.server?.password || '';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Login/register timeout'));
      }, 30000);

      let loggedIn = false;

      const onMsg = (jsonMsg) => {
        if (loggedIn) return;
        const text = jsonMsg.toString().toLowerCase();

        if (text.includes('/l ') || text.includes('/login') || text.includes('please login') || text.includes('log in with')) {
          this.bot.chat(`/l ${password}`);
          this.log.info('Sent login command');
        } else if (text.includes('/r ') || text.includes('/register') || text.includes('please register') || text.includes('register with')) {
          this.bot.chat(`/r ${password} ${password}`);
          this.log.info('Sent register command');
        }

        if (text.includes('successfully') || text.includes('logged in') || text.includes('welcome back') || text.includes('you have been logged in')) {
          loggedIn = true;
          cleanup();
          this.log.info('Login successful');
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.bot.removeListener('message', onMsg);
      };

      this.bot.on('message', onMsg);

      setTimeout(() => {
        if (!loggedIn) {
          this.bot.chat(`/l ${password}`);
        }
      }, 3000);
    });
  }

  async queueLifesteal() {
    this.state = 'QUEUE';
    const queueCmd = this.profile?.commands?.queue || '/queue lifesteal';
    await this.sendCommand(queueCmd);
    this.log.info(`Queued with: ${queueCmd}`);

    const startPos = this.bot.entity.position.clone();
    const queueTimeout = this.config.server?.queueTimeoutMs || 300000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Queue timeout'));
      }, queueTimeout);

      const onMsg = (jsonMsg) => {
        const text = jsonMsg.toString();
        const posMatch = text.match(/position.*?(\d+)/i) || text.match(/queue.*?(\d+)/i);
        if (posMatch) {
          this.log.info(`Queue position: ${posMatch[1]}`);
        }
        if (text.toLowerCase().includes('teleported') || text.toLowerCase().includes('joined lifesteal') || text.toLowerCase().includes('welcome to')) {
          cleanup();
          this.log.info('Entered lifesteal');
          resolve();
        }
      };

      const posCheck = setInterval(() => {
        try {
          const pos = this.bot.entity.position;
          if (pos.distanceTo(startPos) > 100) {
            clearInterval(posCheck);
            cleanup();
            this.log.info('Detected teleport into lifesteal');
            resolve();
          }
        } catch {}
      }, 2000);

      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(posCheck);
        this.bot.removeListener('message', onMsg);
      };
    });
  }

  async rtp(maxRetries = 3) {
    this.state = 'RTP';
    const rtpCmd = this.profile?.commands?.rtp || '/rtp';
    const rtpSlot = this.profile?.commands?.rtp_slot ?? this.config.shop?.rtpSlot ?? 11;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.log.info(`Attempting RTP (try ${attempt}/${maxRetries})...`);
      let window;
      try {
        this.bot.chat(rtpCmd); // Use direct chat for GUI-opening commands (need immediate response)
        window = await waitForWindow(this.bot, 10000);
        window.requiresConfirmation = false;
        await this.bot.clickWindow(rtpSlot, 0, 0);
        this.bot.closeWindow(window);
        this.log.info(`Clicked RTP slot ${rtpSlot}`);
      } catch (err) {
        if (window) { try { this.bot.closeWindow(window); } catch {} }
        this.log.warn(`RTP GUI failed: ${err.message}`);
        if (attempt < maxRetries) {
          await sleep(5000 * attempt);
          continue;
        }
        this.lastRtpAttempt = Date.now();
        return;
      }

      const startPos = this.bot.entity.position.clone();
      await sleep(3000);

      const moved = await new Promise((resolve) => {
        let detected = false;
        const check = setInterval(() => {
          try {
            if (this.bot.entity.position.distanceTo(startPos) > 50) {
              detected = true;
              clearInterval(check);
              resolve(true);
            }
          } catch {}
        }, 500);

        setTimeout(() => {
          if (!detected) clearInterval(check);
          resolve(detected);
        }, 10000);
      });

      if (moved) {
        this.log.info('RTP successful');
        this.lastRtpAttempt = Date.now();
        return;
      }

      this.log.warn(`RTP attempt ${attempt} failed - no position change`);
      if (attempt < maxRetries) {
        await sleep(5000 * attempt);
      }
    }

    this.lastRtpAttempt = Date.now();
  }

  async setHome() {
    const cmd = this.profile?.commands?.sethome || '/sethome';
    this.log.info('Setting home location...');
    await this.sendCommand(cmd);
    await sleep(1000);
    this.homeSet = true;
    this.log.info('Home set');
  }

  async goHome() {
    const cmd = this.profile?.commands?.home || '/home';
    this.log.info('Teleporting home...');
    await this.sendCommand(cmd);
    await sleep(3000);
    this.log.info('Teleported home');
  }

  async applySettings() {
    this.state = 'SETTINGS';
    const cmd = this.profile?.commands?.settings || '/settings';
    const slot = this.profile?.commands?.settings_slot ?? this.config.shop?.settingsMobSlot ?? 23;

    this.log.info('Applying settings...');
    this.bot.chat(cmd); // GUI command - needs immediate response

    try {
      const window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;
      await this.bot.clickWindow(slot, 0, 0);
      this.bot.closeWindow(window);
      this.log.info('Applied settings');
      await sleep(500);
    } catch (err) {
      this.log.warn(`Settings failed (non-critical): ${err.message}`);
    }
  }

  async claimDaily() {
    this.state = 'DAILY';
    const cmd = this.profile?.commands?.daily || '/daily';
    const slot = this.profile?.commands?.daily_slot ?? this.config.shop?.dailyClaimSlot ?? 1;

    this.log.info('Claiming daily reward...');
    this.bot.chat(cmd); // GUI command - needs immediate response

    try {
      const window = await waitForWindow(this.bot, 10000);
      window.requiresConfirmation = false;
      await this.bot.clickWindow(slot, 0, 0);
      this.bot.closeWindow(window);
      this.log.info('Daily reward claimed');
      await sleep(500);
    } catch (err) {
      this.log.warn(`Daily claim failed (probably already claimed): ${err.message}`);
    }
  }

  // Send a command through the rate limiter
  async sendCommand(cmd) {
    if (this.commandQueue) {
      return this.commandQueue.send(cmd);
    }
    this.bot.chat(cmd);
  }

  // Run death recovery sequence from profile
  async runDeathRecovery() {
    if (this.profile?.death_recovery_sequence) {
      this.log.info('Running death recovery from profile...');
      await this.scriptEngine.runSequence(this.profile.death_recovery_sequence);
    } else {
      await sleep(2000);
      await this.goHome();
    }
  }

  async doInitialShopping() {
    this.state = 'SHOPPING';
    await this.economy.refreshBalance();
    this.log.info(`Current balance: $${this.economy.balance}`);

    const shopItems = this.getShopItems();

    // Buy in priority order
    const sortedItems = Object.entries(shopItems).sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));

    for (const [name, itemCfg] of sortedItems) {
      const keywords = itemCfg.keywords || [name];
      const maxPrice = itemCfg.max_price || Infinity;
      const minQty = itemCfg.min_quantity || 0;
      const defaultQty = itemCfg.default_quantity || 1;

      // Check if we need this item
      if (name === 'pickaxe' && this.smartInventory.hasPickaxe()) continue;
      if (name === 'totem' && this.smartInventory.hasTotem()) continue;
      if (name === 'steak') {
        const foodCount = this.smartInventory.getFoodCount();
        if (foodCount >= (minQty || 10)) continue;
      }

      // Try dynamic buy first (from explored shop)
      if (this.shopExplorer && this.shopExplorer.getShopMap()) {
        const bought = await this.shopExplorer.buyItem(keywords, maxPrice);
        if (bought) {
          await sleep(500);
          continue;
        }
      }

      // Fallback to hardcoded slot paths
      if (name === 'pickaxe') {
        await this.economy.buyPickaxe();
      } else if (name === 'steak') {
        const needed = Math.min(defaultQty || 20, 64);
        await this.economy.buySteak(needed);
      } else if (name === 'totem') {
        await this.economy.buyTotem();
      }
      await sleep(500);
    }

    // Equip totem in offhand
    await this.smartInventory.equipTotemOffhand();
  }

  getShopConfig() {
    return this.profile?.shopping || this.config.shop || {};
  }

  getShopItems() {
    const profileItems = this.profile?.shopping?.items || {};
    const configItems = {
      pickaxe: { keywords: ['pickaxe'], max_price: this.config.economy?.pickaxeCost || 700, priority: 1 },
      steak: { keywords: ['cooked_beef', 'steak'], max_price: this.config.economy?.steakCost || 30, priority: 2 },
      totem: { keywords: ['totem'], max_price: this.config.economy?.totemCost || 2500, priority: 3 },
    };
    return { ...configItems, ...profileItems };
  }

  getScriptEngine() {
    return this.scriptEngine;
  }

  getCommandQueue() {
    return this.commandQueue;
  }
}

module.exports = { ServerManager };
