function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function sectorAngle(botIndex, totalBots) {
  const sectorSize = (2 * Math.PI) / totalBots;
  const offset = randomFloat(-sectorSize * 0.3, sectorSize * 0.3);
  return sectorSize * botIndex + offset;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function waitForWindow(bot, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.removeListener('windowOpen', onOpen);
      reject(new Error('GUI did not open in time'));
    }, timeoutMs);
    const onOpen = (window) => {
      clearTimeout(timer);
      resolve(window);
    };
    bot.once('windowOpen', onOpen);
  });
}

function waitForChat(bot, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.removeListener('messagestr', onMsg);
      reject(new Error('Chat message not received in time'));
    }, timeoutMs);
    const onMsg = (msg) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        bot.removeListener('messagestr', onMsg);
        resolve(msg);
      }
    };
    bot.on('messagestr', onMsg);
  });
}

module.exports = { sleep, randomInt, randomFloat, sectorAngle, degToRad, waitForWindow, waitForChat };
