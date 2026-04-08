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

  const bot = mineflayer.createBot({
    connect: async (client) => {
      const { socket } = await SocksClient.createConnection({
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
      client.setSocket(socket);
      client.emit('connect');
    },
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
