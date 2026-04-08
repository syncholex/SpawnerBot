const fs = require('fs');
const path = require('path');
const { SocksClient } = require('socks');

const STATE_DIR = path.resolve(__dirname, '..', 'data');
const PROXY_ASSIGN_FILE = path.join(STATE_DIR, 'proxyAssignments.json');

// Per-proxy health tracking
const proxyHealth = new Map(); // proxyKey -> { successes, failures, lastUsed, lastFail, latencyMs }

// Persisted proxy-to-bot assignments
const proxyAssignments = new Map(); // botIndex -> proxyKey

function loadProxies(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(':');
      return {
        host: parts[0],
        port: parseInt(parts[1], 10),
        userId: parts[2] || undefined,
        password: parts[3] || undefined,
        type: 5,
      };
    });
}

function proxyKey(proxy) {
  if (!proxy) return 'direct';
  return `${proxy.host}:${proxy.port}`;
}

function getProxy(proxies, botIndex) {
  if (proxies.length === 0) return null;
  return proxies[botIndex % proxies.length];
}

// Load persisted proxy assignments from disk
function loadProxyAssignments() {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    if (fs.existsSync(PROXY_ASSIGN_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROXY_ASSIGN_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(data)) proxyAssignments.set(parseInt(k), v);
    }
  } catch {}
}

function saveProxyAssignments() {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(PROXY_ASSIGN_FILE, JSON.stringify(Object.fromEntries(proxyAssignments), null, 2));
  } catch {}
}

// Get the proxy for a bot, preferring the previously assigned one
function getHealthyProxy(proxies, botIndex) {
  if (proxies.length === 0) return null;
  if (proxies.length === 1) return proxies[0];

  // Load persisted assignments if not already loaded
  if (proxyAssignments.size === 0) loadProxyAssignments();

  const now = Date.now();

  // Try to use the same proxy this bot slot used before
  const savedKey = proxyAssignments.get(botIndex);
  if (savedKey) {
    const saved = proxies.find(p => proxyKey(p) === savedKey);
    if (saved) {
      const health = proxyHealth.get(savedKey);
      // Use saved proxy unless it had a recent failure
      if (!health || health.failures === 0 || now - health.lastFail > 10 * 60 * 1000) {
        return saved;
      }
    }
  }

  // No saved proxy or saved proxy is unhealthy - find the healthiest
  const assigned = proxies[botIndex % proxies.length];
  const health = proxyHealth.get(proxyKey(assigned));
  if (!health || health.failures === 0) return assigned;
  if (now - health.lastFail > 10 * 60 * 1000) return assigned;

  let best = null;
  let bestScore = -Infinity;
  for (const proxy of proxies) {
    const h = proxyHealth.get(proxyKey(proxy)) || { successes: 0, failures: 0 };
    const score = h.successes - h.failures * 5;
    if (score > bestScore) {
      bestScore = score;
      best = proxy;
    }
  }

  return best || assigned;
}

// Remember which proxy a bot is using
function assignProxy(botIndex, proxy) {
  proxyAssignments.set(botIndex, proxyKey(proxy));
  saveProxyAssignments();
}

function recordProxySuccess(proxy, latencyMs = 0) {
  const key = proxyKey(proxy);
  const h = proxyHealth.get(key) || { successes: 0, failures: 0, lastUsed: 0, lastFail: 0, latencyMs: 0 };
  h.successes++;
  h.lastUsed = Date.now();
  h.latencyMs = latencyMs;
  proxyHealth.set(key, h);
}

function recordProxyFailure(proxy) {
  const key = proxyKey(proxy);
  const h = proxyHealth.get(key) || { successes: 0, failures: 0, lastUsed: 0, lastFail: 0, latencyMs: 0 };
  h.failures++;
  h.lastFail = Date.now();
  h.lastUsed = Date.now();
  proxyHealth.set(key, h);
}

function getProxyHealth() {
  return Object.fromEntries(proxyHealth);
}

function getProxyAssignments() {
  return Object.fromEntries(proxyAssignments);
}

// Test a single proxy by attempting a SOCKS5 connection
async function testProxy(proxy, testHost = '1.1.1.1', testPort = 80, timeoutMs = 10000) {
  const start = Date.now();
  try {
    await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.userId,
        password: proxy.password,
      },
      command: 'connect',
      destination: { host: testHost, port: testPort },
      timeout: timeoutMs,
    });
    const latency = Date.now() - start;
    recordProxySuccess(proxy, latency);
    return { alive: true, latency, key: proxyKey(proxy) };
  } catch (err) {
    recordProxyFailure(proxy);
    return { alive: false, error: err.message, key: proxyKey(proxy) };
  }
}

// Test all proxies and return results
async function testAllProxies(proxies) {
  const results = [];
  // Test in batches of 5 to avoid overwhelming
  for (let i = 0; i < proxies.length; i += 5) {
    const batch = proxies.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(p => testProxy(p)));
    results.push(...batchResults);
  }
  return results;
}

module.exports = {
  loadProxies, getProxy, getHealthyProxy, assignProxy,
  recordProxySuccess, recordProxyFailure, getProxyHealth, getProxyAssignments,
  testProxy, testAllProxies,
};
