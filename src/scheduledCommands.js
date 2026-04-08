// Scheduled commands: cron-like execution of bot commands
// Supports per-bot and global schedules with simple cron expressions

class ScheduledCommands {
  constructor(log) {
    this.log = log;
    this.schedules = []; // { id, cron, command, botIndex, lastRun, enabled }
    this.timer = null;
    this.nextId = 1;
    this.executionLog = []; // { scheduleId, command, botIndex, timestamp, result }
  }

  // Add a new schedule
  addSchedule(schedule) {
    const entry = {
      id: this.nextId++,
      cron: schedule.cron || '* * * * *',
      command: schedule.command,
      botIndex: schedule.botIndex ?? null, // null = all bots
      lastRun: 0,
      enabled: schedule.enabled !== false,
      description: schedule.description || '',
    };
    this.schedules.push(entry);
    this.log.info(`Schedule added: "${entry.command}" (${entry.cron}) for ${entry.botIndex ?? 'all bots'}`);
    return entry;
  }

  // Remove a schedule
  removeSchedule(id) {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx >= 0) {
      this.schedules.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Toggle schedule enabled/disabled
  toggleSchedule(id) {
    const schedule = this.schedules.find(s => s.id === id);
    if (schedule) {
      schedule.enabled = !schedule.enabled;
      return schedule;
    }
    return null;
  }

  // Update a schedule
  updateSchedule(id, updates) {
    const schedule = this.schedules.find(s => s.id === id);
    if (schedule) {
      Object.assign(schedule, updates);
      return schedule;
    }
    return null;
  }

  getSchedules() {
    return [...this.schedules];
  }

  getExecutionLog(limit = 50) {
    return this.executionLog.slice(-limit);
  }

  // Start the scheduler (checks every minute)
  // executor: async (command, botIndex) => void - called for each match
  start(executor) {
    if (this.timer) return;
    this._executor = executor || (() => {});
    this.log.info('Scheduled commands started');

    // Check every 60 seconds
    this.timer = setInterval(() => {
      const matches = this.checkAndRun();
      for (const match of matches) {
        try { this._executor(match.command, match.botIndex); } catch (e) { this.log.warn(`Scheduled command failed: ${e.message}`); }
      }
    }, 60000);

    // Also check after a short delay
    setTimeout(() => {
      const matches = this.checkAndRun();
      for (const match of matches) {
        try { this._executor(match.command, match.botIndex); } catch (e) { this.log.warn(`Scheduled command failed: ${e.message}`); }
      }
    }, 5000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Check all schedules and run matching ones
  checkAndRun() {
    const now = new Date();
    const matches = [];
    for (const schedule of this.schedules) {
      if (!schedule.enabled) continue;
      if (this.matchesCron(schedule.cron, now)) {
        // Prevent running the same schedule more than once per minute
        if (now.getTime() - schedule.lastRun < 55000) continue;
        schedule.lastRun = now.getTime();
        this.log.info(`Scheduled command: "${schedule.command}" (Bot-${schedule.botIndex ?? 'all'})`);
        matches.push({ schedule, command: schedule.command, botIndex: schedule.botIndex });
        this.executionLog.push({ scheduleId: schedule.id, command: schedule.command, botIndex: schedule.botIndex, timestamp: Date.now() });
        if (this.executionLog.length > 200) this.executionLog.splice(0, this.executionLog.length - 200);
      }
    }
    return matches;
  }

  // Simple 5-field cron parser: minute hour day-of-month month day-of-week
  // Supports: *, specific values, ranges (1-5), steps (*/5), lists (1,3,5)
  matchesCron(expression, date) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return false;

    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();

    return (
      this.matchField(fields[0], minute, 0, 59) &&
      this.matchField(fields[1], hour, 0, 23) &&
      this.matchField(fields[2], dayOfMonth, 1, 31) &&
      this.matchField(fields[3], month, 1, 12) &&
      this.matchField(fields[4], dayOfWeek, 0, 6)
    );
  }

  matchField(field, value, min, max) {
    if (field === '*') return true;

    // Handle step: */5
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2));
      return step > 0 && value % step === 0;
    }

    // Handle list: 1,3,5
    if (field.includes(',')) {
      return field.split(',').some(f => this.matchField(f.trim(), value, min, max));
    }

    // Handle range: 1-5
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number);
      return value >= start && value <= end;
    }

    // Handle exact value
    return parseInt(field) === value;
  }

  // Validate a cron expression
  validateCron(expression) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return { valid: false, error: 'Expected 5 fields' };

    const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    for (let i = 0; i < 5; i++) {
      if (!this.validateField(fields[i], ranges[i][0], ranges[i][1])) {
        return { valid: false, error: `Invalid field ${i + 1}: ${fields[i]}` };
      }
    }
    return { valid: true };
  }

  validateField(field, min, max) {
    if (field === '*') return true;
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2));
      return !isNaN(step) && step > 0;
    }
    if (field.includes(',')) {
      return field.split(',').every(f => this.validateField(f.trim(), min, max));
    }
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max;
    }
    const val = parseInt(field);
    return !isNaN(val) && val >= min && val <= max;
  }

  // Human-readable description of a cron expression
  describeCron(expression) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return 'Invalid expression';

    const [min, hour, dom, mon, dow] = fields;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let desc = '';
    if (hour === '*' && min === '*') desc = 'Every minute';
    else if (hour === '*' && min.startsWith('*/')) desc = `Every ${min.slice(2)} minutes`;
    else if (hour !== '*' && min !== '*') desc = `At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    else if (hour !== '*') desc = `Every hour at :${min === '*' ? '00' : min.padStart(2, '0')}`;
    else desc = `At minute ${min}`;

    if (dow !== '*') desc += ` on ${days[parseInt(dow)] || dow}`;
    if (dom !== '*') desc += ` on day ${dom}`;

    return desc;
  }
}

module.exports = { ScheduledCommands };
