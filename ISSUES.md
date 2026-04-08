# MCBOT Known Issues & Remaining Features

## Known Bugs (Open)

### Spawner race condition between bots (Medium)
**File**: `spawnerHunter.js:321-324`
Two bots scanning the same area could both pass `isKnown()` check before either calls `addSpawner()`, resulting in both trying to mine the same spawner. The second bot's `collectOne()` would mine air.
**Severity**: Medium - mitigated by sector-based exploration giving bots different areas, but overlaps happen at sector edges.

### SSE endpoint bypasses auth (Medium)
**File**: `webServer.js:81`
The `/sse` endpoint skips authentication so that EventSource clients (which can't set custom headers) can connect. This means anyone with the URL can read all bot data, chat messages, and status updates without logging in.
**Severity**: Medium - dashboard data exposed, but no write access.

### Auth comparison vulnerable to timing attacks (Low)
**File**: `webServer.js:80`
`token === webPassword` uses direct string comparison. A timing-attacker could measure response times to progressively guess the password character by character.
**Severity**: Low - local network tool, unrealistic attack vector.

### Path traversal via symlinks (Low)
**File**: `webServer.js:133, 396`
`resolved.startsWith(projectRoot)` blocks `../` traversal but not symlinks inside the project directory that point outside it.
**Severity**: Low - requires write access to project directory.

### Config webPort change requires restart (Expected)
Express server is already listening when config is hot-reloaded. Port changes don't take effect until process restart.

### Bot-to-bot messaging depends on server /msg
Item lending uses in-game `/msg` for coordination. If the server disables or filters `/msg`, lending fails silently. Shop purchases still work as fallback.

### Spawner type detection depends on server NBT
Some servers strip block entity data. Type falls back to "unknown". Functionality unaffected.

## Dead Code

### `shopExplorer.findItems()` (Low)
**File**: `shopExplorer.js:214-223`
`findItems()` (plural, returns array) is defined but never called. `findItem()` (singular) is what consumers use. Should be removed or used to provide "show all matching items" functionality.

## Bugs - FIXED (Round 5)

- [x] **Lending listener leak on shared `botEvents`** — `_setupLendingListener()` added a listener per bot start with no removal. Now tracked and removed in `stop()`.
- [x] **AntiCaptcha listener leak** — `bot.on('message')` added but never removed. `stop()` now calls `removeListener()`.
- [x] **botSurvival doesn't stop antiCaptcha** — `stop()` never called `antiCaptcha.stop()`. Fixed.
- [x] **Item name substring matching** — `item.name.includes(itemName)` could match wrong items (e.g., "diamond" matching "diamond_pickaxe"). Changed to `===`.
- [x] **Path traversal in webServer** — Profile and accounts endpoints didn't validate resolved paths. Now checks path stays under project root.
- [x] **Scheduled command errors swallowed** — Empty catches in executor. Now logs warnings.
- [x] **Lending history unbounded growth** — No cap on `lendingHistory` array. Capped at 100 entries.
- [x] **Dead instance `getBotPositions()`** — Duplicate instance method never used externally. Removed.
- [x] **Empty catches in spawnerHunter** — Key catch blocks now log at debug level.

## Bugs - FIXED (Round 4)

- [x] **Duplicate `deepMerge` function** — Created `src/shared.js` module, both now import from it.
- [x] **Pause hours don't restart bots** — Now remembers running slots/usernames and auto-restarts them.
- [x] **Maintenance restart race condition** — Clears reconnect timer before stopping, saves username.
- [x] **Host bot double cleanup** — Added `cleanedUp` guard flag.
- [x] **Inventory full not shown in dashboard** — Now tracks `inventoryFull` from hunter.
- [x] **Config reload doesn't update server profile** — Now reloads profile on hot-reload.
- [x] **Host bot leaked intervals** — `stop()` now clears `storageInterval` and `statusInterval`.
- [x] **Shop map lost on restart** — Persisted to `data/shopMap.json`.
- [x] **Item lending never triggered** — Added `botEvents` event bus and lending listener.
- [x] **Anti-detection module not wired** — Now started in `SpawnerHunter.start()`.
- [x] **Redundant `botEventBus`** — Removed unused event bus from index.js.
- [x] **`isPaused` undeclared** — Added `let isPaused = false`.
- [x] **`metrics.init()` accidentally removed** — Restored.

## Bugs - FIXED (Round 3)

- [x] **`bot.equip()` fire-and-forget in tryEat** — Made `tryEat()` async with proper await and error logging
- [x] **`kicked` + `end` both trigger cleanup** — Added `cleanedUp` guard flag
- [x] **Webhook errors silently swallowed** — Added `mainLog.warn()` on webhook request errors
- [x] **`createBot` return type inconsistency** — Made `createDirectBot` async
- [x] **`stopAll` function naming collision** — Unified to `stopAll()`

## Bugs - FIXED (Round 2)

- [x] **CRITICAL: No `bot.respawn()` after death**
- [x] **`this.totalBots` never assigned in Explorer**
- [x] **`const window` shadowed `let window` in disposeItems**
- [x] **`BotCoordinator.getBotPositions()` called as static** — Added static method.
- [x] **Balance $0 rejected** — Changed `<= 0` to `< 0`.
- [x] **`detect_and_respond` with success_pattern always timed out**
- [x] **Multiple triggers firing for one message**

## Bugs - FIXED (Round 1)

- [x] `getAllBotStatuses()` placeholder → wired to `getBotStatuses()`
- [x] Balance parsing too broad → added `pendingBalance` flag
- [x] Daily claim duplication → reuses `serverManager.claimDaily()`
- [x] Double `scanForSpawners()` → main scan `continue`s past RTP block
- [x] `server.password` missing from config → added to form + save
- [x] Log file accumulation → added rotation

## Remaining Features (Future)

### Medium Priority
1. **WebSocket alternative to SSE** — Bidirectional communication for lower latency
2. **Metrics persistence** — Save metrics snapshots to disk for long-term analysis across restarts
3. **Spawner race lock** — Add a lock/mutex around `addSpawner` + `markMined` to prevent two bots mining the same spawner
4. **Proxy rotation strategy** — Rotate based on latency and success rate, not just failure-based skip
5. **Account rotation** — Rotate Microsoft accounts to avoid single-account detection patterns
6. **SSE auth via query param** — Support `EventSource('/sse?token=xxx')` so the SSE endpoint can be auth-protected

### Low Priority
7. **Remove dead `findItems()`** — Clean up unused method in shopExplorer
8. **Staff detection via tab list** — Check tab list display names in addition to nearby player names
9. **Script validation** — Pre-validate server profile scripts before execution
10. **Potion effect handling** — Account for speed/night vision effects in movement calculations
11. **Custom username patterns** — User-defined prefixes/suffixes for generated usernames
12. **Structured log output** — JSON-formatted log option for machine parsing
13. **Network latency metrics** — Track per-proxy and per-server latency for debugging
