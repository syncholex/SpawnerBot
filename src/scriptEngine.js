// Script Engine: Executes JSON-defined action sequences
// Makes bot behavior server-agnostic - each server gets a profile that drives all interactions

const { sleep, waitForWindow, waitForChat } = require('./utils');

class ScriptEngine {
  constructor(bot, log) {
    this.bot = bot;
    this.log = log;
    this.variables = {}; // Runtime state: {balance, hasPickaxe, etc.}
  }

  // Execute a sequence of actions
  async runSequence(actions, context = {}) {
    for (let i = 0; i < actions.length; i++) {
      if (!actions[i]) continue;
      const result = await this.executeAction(actions[i], context);
      if (result === 'BREAK') break;
      if (result === 'RETRY') { i--; continue; }
    }
  }

  // Execute a single action
  async executeAction(action, context = {}) {
    const type = action.type || action.action;
    try {
      switch (type) {
        case 'chat': return await this.actionChat(action, context);
        case 'gui_click': return await this.actionGuiClick(action, context);
        case 'gui_click_item': return await this.actionGuiClickItem(action, context);
        case 'gui_close': return await this.actionGuiClose(action, context);
        case 'wait': return await this.actionWait(action, context);
        case 'wait_for_chat': return await this.actionWaitForChat(action, context);
        case 'wait_for_teleport': return await this.actionWaitForTeleport(action, context);
        case 'wait_for_window': return await this.actionWaitForWindow(action, context);
        case 'detect_and_respond': return await this.actionDetectRespond(action, context);
        case 'if_has_item': return await this.actionIfHasItem(action, context);
        case 'if_balance': return await this.actionIfBalance(action, context);
        case 'if_chat_matches': return await this.actionIfChatMatches(action, context);
        case 'set_variable': return await this.actionSetVariable(action, context);
        case 'try': return await this.actionTry(action, context);
        case 'retry': return 'RETRY';
        case 'log': return this.actionLog(action, context);
        case 'sequence': return await this.runSequence(action.steps || [], context);
        default:
          this.log.warn(`Unknown script action type: ${type}`);
          return null;
      }
    } catch (err) {
      if (action.optional) return null;
      throw err;
    }
  }

  // --- Action Implementations ---

  async actionChat(action) {
    const cmd = this.interpolate(action.command || action.msg || '');
    this.bot.chat(cmd);
    if (action.wait_after) await sleep(action.wait_after);
  }

  async actionGuiClick(action) {
    const cmd = this.interpolate(action.command || '');
    if (cmd) {
      this.bot.chat(cmd);
      if (action.wait_for_window !== false) {
        const window = await waitForWindow(this.bot, action.timeout || 10000);
        window.requiresConfirmation = false;
        const slot = action.slot != null ? action.slot : 0;
        await this.bot.clickWindow(slot, 0, 0);
        await sleep(action.click_delay || 400);

        if (action.wait_for_teleport) {
          await this.waitForTeleport(action.teleport_distance || 50, action.teleport_timeout || 15000);
        }

        if (action.close !== false) {
          this.bot.closeWindow(window);
        }
        return window;
      }
    } else if (action.slot != null) {
      // Click in current window (no command to open)
      await this.bot.clickWindow(action.slot, 0, 0);
      await sleep(action.click_delay || 400);
    }
  }

  async actionGuiClickItem(action) {
    const cmd = this.interpolate(action.command || '');
    if (cmd) this.bot.chat(cmd);

    const window = await waitForWindow(this.bot, action.timeout || 10000);
    window.requiresConfirmation = false;

    // Find the slot containing the target item
    const keywords = Array.isArray(action.item) ? action.item : [action.item];
    let found = false;
    for (let i = 0; i < window.slots.length; i++) {
      const slot = window.slots[i];
      if (!slot) continue;
      const name = (slot.name || '').toLowerCase();
      const display = (slot.displayName || '').toLowerCase();
      if (keywords.some(kw => name.includes(kw.toLowerCase()) || display.includes(kw.toLowerCase()))) {
        await this.bot.clickWindow(i, 0, 0);
        await sleep(action.click_delay || 400);
        found = true;
        break;
      }
    }

    if (!found && !action.optional) {
      this.log.warn(`GUI item not found: ${keywords.join(', ')}`);
    }

    if (action.wait_for_teleport) {
      await this.waitForTeleport(action.teleport_distance || 50, action.teleport_timeout || 15000);
    }

    if (action.close !== false) {
      this.bot.closeWindow(window);
    }
  }

  async actionGuiClose() {
    try {
      const window = this.bot.currentWindow;
      if (window) this.bot.closeWindow(window);
    } catch {}
  }

  async actionWait(action) {
    const ms = action.ms || action.duration || 1000;
    await sleep(ms);
  }

  async actionWaitForChat(action) {
    const pattern = action.pattern || action.match || '';
    const timeout = action.timeout || 30000;
    try {
      await waitForChat(this.bot, (msg) => {
        const lower = msg.toLowerCase();
        const patterns = pattern.split('|');
        return patterns.some(p => lower.includes(p.toLowerCase()));
      }, timeout);
    } catch {
      if (!action.optional) throw new Error(`Chat pattern not matched: ${pattern}`);
    }
  }

  async actionWaitForTeleport(action) {
    const minDist = action.min_distance || action.distance || 50;
    const timeout = action.timeout || 15000;
    await this.waitForTeleport(minDist, timeout);
  }

  async actionWaitForWindow(action) {
    const timeout = action.timeout || 10000;
    const window = await waitForWindow(this.bot, timeout);
    window.requiresConfirmation = false;
    return window;
  }

  async actionDetectRespond(action) {
    // Listen for chat messages and respond to matching patterns
    const triggers = action.triggers || [];
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, action.timeout || 30000);

      let responded = false;

      const onMsg = (jsonMsg) => {
        if (responded) return;
        const text = jsonMsg.toString().toLowerCase();

        for (const trigger of triggers) {
          const pattern = trigger.detect_pattern || trigger.pattern || '';
          const patterns = pattern.split('|');
          if (patterns.some(p => p && text.includes(p.toLowerCase()))) {
            const response = this.interpolate(trigger.response || trigger.command || '');
            this.bot.chat(response);
            this.log.info(`Detected "${pattern}", responded with "${response}"`);
            responded = true;

            const successPattern = trigger.success_pattern || trigger.success;
            if (!successPattern) {
              // No success pattern to wait for - done immediately
              clearTimeout(timer);
              cleanup();
              resolve(true);
              return;
            }

            // Now wait for the success pattern
            const successPatterns = successPattern.split('|').filter(p => p);
            const onSuccess = (successMsg) => {
              const successText = successMsg.toString().toLowerCase();
              if (successPatterns.some(p => successText.includes(p.toLowerCase()))) {
                clearTimeout(timer);
                this.bot.removeListener('message', onSuccess);
                cleanup();
                resolve(true);
              }
            };
            this.bot.on('message', onSuccess);
            return; // Stop checking other triggers
          }
        }
      };

      const cleanup = () => this.bot.removeListener('message', onMsg);
      this.bot.on('message', onMsg);
    });
  }

  async actionIfHasItem(action) {
    const keywords = Array.isArray(action.item) ? action.item : [action.item || ''];
    const hasItem = this.bot.inventory.items().some(item => {
      const name = item.name.toLowerCase();
      return keywords.some(kw => name.includes(kw.toLowerCase()));
    });

    if (hasItem) {
      if (action.then) await this.runSequence(action.then);
    } else {
      if (action.else) await this.runSequence(action.else);
    }
  }

  async actionIfBalance(action) {
    const balance = this.variables.balance || 0;
    if (balance >= (action.min || 0)) {
      if (action.then) await this.runSequence(action.then);
    } else {
      if (action.else) await this.runSequence(action.else);
    }
  }

  async actionIfChatMatches(action) {
    const pattern = action.pattern || '';
    const timeout = action.timeout || 5000;
    try {
      const msg = await waitForChat(this.bot, (m) => {
        return pattern.split('|').some(p => m.toLowerCase().includes(p.toLowerCase()));
      }, timeout);

      if (action.then) await this.runSequence(action.then, { matchedMessage: msg });
    } catch {
      if (action.else) await this.runSequence(action.else);
    }
  }

  async actionSetVariable(action) {
    for (const [key, value] of Object.entries(action.vars || {})) {
      this.variables[key] = this.interpolate(String(value));
    }
  }

  async actionTry(action) {
    try {
      if (action.then) await this.runSequence(action.then);
    } catch (err) {
      if (action.catch) await this.runSequence(action.catch);
      else this.log.debug(`Try/catch suppressed: ${err.message}`);
    }
  }

  actionLog(action) {
    const level = action.level || 'info';
    const msg = this.interpolate(action.message || action.msg || '');
    this.log[level](msg);
  }

  // --- Helpers ---

  waitForTeleport(minDistance = 50, timeoutMs = 15000) {
    const startPos = this.bot.entity.position.clone();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(check);
        reject(new Error('Teleport timeout'));
      }, timeoutMs);

      const check = setInterval(() => {
        try {
          if (this.bot.entity.position.distanceTo(startPos) > minDistance) {
            clearInterval(check);
            clearTimeout(timer);
            resolve();
          }
        } catch {}
      }, 500);
    });
  }

  // Replace {variable} placeholders in strings
  interpolate(str) {
    return str.replace(/\{(\w+)\}/g, (_, key) => {
      if (this.variables[key] !== undefined) return String(this.variables[key]);
      return `{${key}}`;
    });
  }

  // Set a variable
  setVar(key, value) {
    this.variables[key] = value;
  }

  // Get a variable
  getVar(key) {
    return this.variables[key];
  }
}

module.exports = { ScriptEngine };
