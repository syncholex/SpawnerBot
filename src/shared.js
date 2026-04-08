// Shared utilities used across modules
// Prevents code duplication between index.js, webServer.js, etc.

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
        ? deepMerge(target[key], source[key])
        : source[key];
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { deepMerge };
