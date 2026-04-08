const { SocksClient } = require('socks');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const collectblock = require('mineflayer-collectblock');

async function createBot({ proxy, server, credentials, version, log }) {
  if (proxy) {
    return createProxiedBot({ proxy, server, credentials, version, log });
  }
  return createDirectBot({ server, credentials, version, log });
}

async function createProxiedBot({ proxy, server, credentials, version, log }) {
  log.info(`Connecting via SOCKS5 proxy ${proxy.host}:${proxy.port}`);

  const connectPromise = SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      userId: proxy.userId,
      password: proxy.password,
    },
    command: 'connect',
    destination: { host: server.host, port: server.port },
  });

  // 30s connection timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Proxy connection timeout (30s)')), 30000)
  );

  const { socket } = await Promise.race([connectPromise, timeoutPromise]);

  const bot = mineflayer.createBot({
    stream: socket,
    host: server.host,
    port: server.port,
    username: credentials.username,
    password: credentials.password,
    auth: credentials.auth,
    version,
  });

  loadPlugins(bot);
  return bot;
}

async function createDirectBot({ server, credentials, version, log }) {
  log.info('Connecting directly (no proxy)');

  const bot = mineflayer.createBot({
    host: server.host,
    port: server.port,
    username: credentials.username,
    password: credentials.password,
    auth: credentials.auth,
    version,
  });

  loadPlugins(bot);
  return bot;
}

function loadPlugins(bot) {
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectblock.plugin);
}

module.exports = { createBot };
