# MCBOT Known Issues & Remaining Features

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

- [x] **Duplicate `deepMerge` function** — `index.js` and `webServer.js` both defined identical deepMerge. Created `src/shared.js` module, both now import from it.
- [x] **Pause hours don't restart bots** — When maintenance pause ended, bots were never restarted. Now remembers running slots/usernames and auto-restarts them.
- [x] **Maintenance restart race condition** — Reconnect timer could fire after stopBot, causing ghost reconnects. Now clears reconnect timer before stopping.
- [x] **Host bot double cleanup** — `kicked` and `end` events both trigger cleanup, causing double-stop errors. Added `cleanedUp` guard flag.
- [x] **Inventory full not shown in dashboard** — Bot status updates didn't include inventory full status. Now tracks `inventoryFull` from hunter.
- [x] **Config reload doesn't update server profile** — Changing serverProfile in config had no effect until restart. Now reloads profile on hot-reload.
- [x] **Host bot leaked intervals** — `stop()` method didn't clear `storageInterval` or `statusInterval`. Fixed with proper cleanup.
- [x] **Shop map lost on restart** — Explored shop data was only in memory. Now persisted to `data/shopMap.json`.
- [x] **Item lending never triggered** — Lender bots had no listener for lending requests. Added `botEvents` event bus and lending listener.
- [x] **Anti-detection module not wired** — `AntiDetection` class existed but was never instantiated. Now started in `SpawnerHunter.start()`.
- [x] **Redundant `botEventBus` never emitted to** — Removed unused event bus from index.js. Lending uses `botEvents` from botCoordinator.
- [x] **`isPaused` undeclared in pause hours** — Variable used but not declared. Added `let isPaused = false`.
- [x] **`metrics.init()` accidentally removed** — Was deleted from hunter spawn handler. Restored to prevent metrics not tracking bots.

## Bugs - FIXED (Round 3)

- [x] **`bot.equip()` fire-and-forget in tryEat** — Made `tryEat()` async with proper await and error logging
- [x] **`kicked` + `end` both trigger cleanup** — Added `cleanedUp` guard flag on instance to prevent double cleanup
- [x] **Webhook errors silently swallowed** — Added `mainLog.warn()` on webhook request errors
- [x] **`createBot` return type inconsistency** — Made `createDirectBot` async to match `createProxiedBot`
- [x] **`stopAll` function naming collision** — Removed redundant `stopAllBots()`, unified to `stopAll()`

## Bugs - FIXED (Round 2)

- [x] **CRITICAL: No `bot.respawn()` after death** — Bot stayed dead permanently. Added `bot.respawn()` with 2s delay in death handler.
- [x] **`this.totalBots` never assigned in Explorer** — Direction reset always divided by 1. Added `this.totalBots = totalBots` to constructor.
- [x] **`const window` shadowed `let window` in disposeItems** — Catch block could never close the window. Fixed variable declaration.
- [x] **`BotCoordinator.getBotPositions()` called as static** — Was instance method, bot spacing never worked. Added static method.
- [x] **Balance $0 rejected** — Bot couldn't track zero balance state. Changed `parsed <= 0` to `parsed < 0`.
- [x] **`detect_and_respond` with success_pattern always timed out** — Never listened for success pattern after responding. Added success pattern listener after response sent.
- [x] **Multiple triggers firing for one message in detect_and_respond** — Added `responded` flag to stop after first match.

## Bugs - FIXED (Round 1)

- [x] **#1** `getAllBotStatuses()` placeholder → wired to `getBotStatuses()` from webServer
- [x] **#2** Balance parsing too broad → added `pendingBalance` flag, only parses after `/bal`
- [x] **#4** Daily claim duplication → removed inline code, reuses `serverManager.claimDaily()`
- [x] **#8** Double `scanForSpawners()` → main scan `continue`s past RTP block
- [x] **#11** `server.password` missing from config → added to form + save function
- [x] **#12** Log file accumulation → added rotation (10MB max, 5 files, 7 day cleanup)

## Known Acceptable Behaviors

### Config `webPort` change not applied at runtime
Express server is already listening. Changing webPort requires process restart.
**Severity**: Low - expected behavior.

### Bot-to-bot messaging depends on server /msg
Item lending uses in-game `/msg` for bot coordination. If the server disables or filters /msg, lending will fail silently.
**Severity**: Low - fallback to shop purchases still works.

### Spawner type detection depends on server NBT
Some servers strip block entity data. If NBT is unavailable, spawner type falls back to "unknown".
**Severity**: Low - functionality unaffected, just less detail.

## Remaining (Future)

### Medium Priority
1. **WebSocket alternative to SSE** — Bidirectional communication for lower latency (SSE + REST works fine currently)
2. **Metrics persistence** — Save metrics snapshots to disk for long-term analysis across restarts
3. **Visual spawners/hr chart** — Dashboard time-series chart for spawners/hr over time (line chart infrastructure exists)
4. **Proxy rotation strategy** — Rotate proxies based on latency and success rate, not just failure-based skip
5. **Account rotation** — Rotate Microsoft accounts to avoid single-account detection patterns

### Low Priority
6. **Script validation** — Pre-validate server profile scripts before execution
7. **Staff detection via tab list** — Check tab list display names in addition to nearby player names
8. **Potion effect handling** — Account for speed/night vision effects in movement calculations
9. **Custom username patterns** — User-defined prefixes/suffixes for generated usernames
10. **Log structured output** — JSON-formatted log option for machine parsing
