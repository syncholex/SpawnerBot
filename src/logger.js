const winston = require('winston');
const path = require('path');
const fs = require('fs');

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, label }) => {
  const prefix = label ? `[${label}] ` : '';
  const levelStr = level.toUpperCase().padEnd(7);
  return `${timestamp} ${levelStr} ${prefix}${message}`;
});

function createLogger(label = 'MCBOT', logDir = './logs', toFile = true) {
  if (toFile) {
    fs.mkdirSync(logDir, { recursive: true });
    cleanOldLogs(logDir);
  }

  const transports = [
    new winston.transports.Console({
      format: combine(colorize(), logFormat),
    }),
  ];

  if (toFile) {
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, `mcbot-${Date.now()}.log`),
        format: logFormat,
        maxsize: 10 * 1024 * 1024, // 10MB max per file
        maxFiles: 5,
      })
    );
  }

  return winston.createLogger({
    level: 'info',
    format: combine(timestamp({ format: 'HH:mm:ss' }), logFormat),
    defaultMeta: { label },
    transports,
  });
}

// Remove log files older than 7 days, keep max 20 files
function cleanOldLogs(logDir) {
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, path: path.join(logDir, f), time: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;
    for (let i = 0; i < files.length; i++) {
      if (i >= 20 || now - files[i].time > sevenDays) {
        try { fs.unlinkSync(files[i].path); removed++; } catch {}
      }
    }
    if (removed > 0) console.log(`[Logger] Cleaned ${removed} old log file(s)`);
  } catch {}
}

function createBotLogger(botIndex, logDir, toFile) {
  const label = `Bot-${String(botIndex).padStart(2, '0')}`;
  return createLogger(label, logDir, toFile);
}

module.exports = { createLogger, createBotLogger };
