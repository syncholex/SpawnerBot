const fs = require('fs');
const crypto = require('crypto');
const { generate } = require('./usernameGenerator');

function getCredentials(authMode, botIndex, accountsFile, customUsernames) {
  if (authMode === 'microsoft') {
    const accounts = loadAccounts(accountsFile);
    const account = accounts[botIndex % accounts.length];
    return {
      username: account.email,
      password: account.password,
      auth: 'microsoft',
    };
  }

  // Offline/cracked mode
  if (customUsernames && customUsernames[botIndex]) {
    return {
      username: customUsernames[botIndex],
      password: generatePassword(customUsernames[botIndex]),
      auth: 'offline',
    };
  }

  const names = generate(1);
  return {
    username: names[0],
    password: generatePassword(names[0]),
    auth: 'offline',
  };
}

// Generate a unique deterministic password per bot
function generatePassword(seed) {
  return crypto.createHash('sha256').update(seed + '_mcbot').digest('hex').substring(0, 16);
}

function generateUsernames(count) {
  return generate(count);
}

function loadAccounts(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.accounts || [];
  } catch { return []; }
}

module.exports = { getCredentials, generateUsernames, loadAccounts };
