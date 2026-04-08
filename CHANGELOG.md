# MCBOT Changelog

## [Unreleased]

### Fixed - Audit Round 5
- **Lending listener leak** - `botEvents.on('bot-message')` listener in `_setupLendingListener()` accumulated per bot start. Now tracked and removed in `stop()`.
- **AntiCaptcha listener leak** - `bot.on('message')` listener never removed. `stop()` now properly calls `removeListener()`.
- **BotSurvival cleanup** - `stop()` now calls `antiCaptcha.stop()` to clean up captcha detection listeners.
- **Exact item matching** - `itemLending.js` now uses `===` instead of `.includes()` for item name lookups, preventing false matches.
- **Path traversal protection** - Profile and accounts file endpoints in webServer now validate resolved paths stay under project root.
- **Scheduled command error logging** - Empty catches in command executor now log failures instead of silently swallowing.
- **Lending history cap** - `lendingHistory` array now capped at 100 entries to prevent unbounded memory growth.
- **Removed dead instance method** - Duplicate `getBotPositions()` instance method removed from BotCoordinator (static version is the one used).
- **Logged empty catches** - Key empty catch blocks in `spawnerHunter.js` now log errors at debug level.

### Fixed - Architecture & Integration (Round 4)
- **Shared `deepMerge` utility** (`src/shared.js`) - Eliminated duplicate deepMerge function between index.js and webServer.js. Both now import from shared module.
- **Pause hours auto-restart** - When maintenance pause hours end, bots are now automatically restarted (previously just set a flag). Remembers which slots/usernames were running and restarts them.
- **Maintenance restart race condition** - Clears reconnect timers before stopping bots during scheduled maintenance restarts. Saves username before stopBot to ensure correct reconnect.
- **Host bot cleanup guard** - Added `cleanedUp: false` flag to host bot instances, preventing double-cleanup from `kicked` + `end` events.
- **Inventory full status tracking** - Bot status updates now include `inventoryFull` field from hunter's `isInventoryFull()` method, reflected in dashboard.
- **Config hot-reload reloads server profile** - `reloadConfig()` now also reloads the server profile if the path changed.
- **Host bot interval cleanup** - `HostBot.stop()` now properly clears `storageInterval` and `statusInterval`, preventing leaked timers.
- **Shop map persistence** - Shop explorer data is saved to `data/shopMap.json` and reloaded on restart, avoiding repeated shop exploration.
- **Bot-to-bot messaging** - `botCoordinator.js` has a shared `botEvents` EventEmitter for inter-bot communication via `/msg [bot-msg]` protocol.
- **Item lending listener** - `spawnerHunter.js` sets up a lending listener that responds to bot-to-bot item requests.
- **Anti-detection wired** - `AntiDetection` module is now instantiated in both index.js and SpawnerHunter.start() with guard to prevent duplicates.
- **Death rate limiting** - index.js tracks death timestamps per bot and stops bots exceeding 5 deaths in 10 minutes.
- **Web server health endpoint** - `GET /api/health` returns uptime, bot count, memory usage.
- **SSE heartbeat** - Server sends heartbeat every 30s to detect dead SSE connections.
- **Bulk bot actions API** - `POST /api/bots/action` supports running commands (daily, rtp, inventory) across all bots at once.
- **Command history tracking** - Web server tracks commands sent via the UI for audit purposes.
- **Removed redundant event bus** - Cleaned up duplicate `botEventBus` that was never emitted to. Lending uses `botEvents` from botCoordinator.
- **Fixed `isPaused` scope** - Variable was used but not declared in pause hours block.
- **Fixed metrics.init()** - Restored `metrics.init(index)` call in hunter spawn handler that was accidentally removed.

### Added - Host Bot System
- **Host bot module** (`src/hostBot.js`) - Dedicated host bots that stay at `/home` and collect spawners from hunting bots. 1 host bot per 10 hunters (configurable via `hostBot.hunterToHostRatio`). Auto-accepts TPA from hunters, picks up dropped spawners, and stores them in black shulker boxes.
- **Shulker box storage pipeline** - Host bots buy black shulker boxes from `/shop`, place them, transfer loose spawners inside, break and collect the filled shulker. Keeps inventory clean with only shulker boxes containing spawners.
- **Hunter-to-host spawner transfer** - Hunters periodically check spawner count against `hostBot.spawnerTransferThreshold` (default: 64). When exceeded, hunter teleports home, TPA's to assigned host bot, and drops spawners for pickup.
- **Round-robin host assignment** - `assignHuntersToHosts()` distributes hunters evenly across host bots. Mapping persisted in `hunterToHost` object.
- **Host bot dashboard visibility** - Host bots shown with `[HOST]` tag, accent border, and dedicated stats (loose spawners, shulker boxes, total stored, assigned hunters). Reduced action buttons (no Daily/RTP/Buy actions).

### Added - Staff Detection & Safety
- **Staff player detection** - `BotSurvival.isStaffPlayer()` checks player display names for staff rank keywords (admin, owner, mod, helper, staff, developer). Staff detection triggers immediate emergency logout.
- **Global staff tracking** - `BotCoordinator.setStaffOnline()` / `isStaffOnline()` / `getOnlineStaff()` tracks which staff members are currently online across all bots.
- **Staff alert banner** - Dashboard shows a pulsing red alert banner when staff are detected online, visible on all pages.
- **Staff status API** - `GET /api/staff` returns `{ staffOnline, isStaffOnline }`.

### Added - Error Handling & Metrics
- **Global unhandled exception/rejection handlers** - Catches uncaught exceptions and unhandled promise rejections without crashing. Logs full stack traces.
- **Efficiency metrics** - Dashboard shows spawners/hour (1h and 24h) calculated from time-series data. `getStats()` now includes `efficiency: { sph1h, sph24h, mined1h, mined24h }`.
- **Bot uptime tracking** - Each bot tracks time since spawn. Shown in dashboard bot cards as `Xh Ym`.
- **Pause hours** - Config `maintenance.pauseHoursStart` and `pauseHoursEnd` now functional. Stops all bots during configured hours (e.g. peak admin time). Supports overnight ranges (e.g. 22-6).
- **Proxy connection timeout** - 30s timeout on SOCKS5 proxy connections. Prevents hanging indefinitely on dead proxies.
- **Command queue connection check** - `CommandQueue` now checks `bot.entity` before sending. Rejects queued commands if bot disconnected.
- **Improved log formatting** - Log levels padded and uppercased for better column alignment.

### Fixed - Bugs from Audit
- **`botStatuses` undefined in index.js** - Status interval referenced `botStatuses` (local to webServer.js) instead of `getBotStatuses()`. Trail tracking was silently failing.
- **Economy balance race condition** - Balance was deducted optimistically before purchase confirmed. Now relies on `refreshBalance()` after all purchases to get actual server-side balance.
- **`pendingBalance` never reset** - If `/bal` response was missed, `pendingBalance` stayed `true` forever, accepting random chat as balance. Now reset after timeout.
- **`spawnerStore.getStats()` undefined access** - `recent.find(p => p.t >= h1)?.t` could return `undefined`, causing `NaN` in efficiency calculation. Fixed with explicit null check.
- **Command queue sends on disconnected bots** - Queue continued processing when bot disconnected. Now checks connection state before each send.
- **Dashboard stats expansion** - Now shows: Online, Hosts, Found, Mined, Balance, Held, Stored (in shulkers), Chunks, Mined/hr, 24h rate.
- **Improved log formatting** - Log levels now padded and uppercased (e.g. `INFO    ` instead of `info`) for better column alignment in log files.

### Fixed - Integration Review (Critical)
- **CRITICAL: `broadcastSSE` not exported** - `webServer.js` did not include `broadcastSSE` in `module.exports`. Every `setBotStatus()` call (which internally calls `broadcastSSE`) would crash with `TypeError`. **Entire dashboard was non-functional** - no status updates, no chat relay, no real-time data.
- **Bot flees from passive mobs** - `getNearbyHostiles()` used `e.kind` which is not a mineflayer property (always `undefined`). Filter passed for ALL mobs including pigs, cows, sheep. Bot wasted time fleeing from harmless animals. Fixed with explicit `HOSTILE_MOBS` set of 30+ mob names.
- **`gracefulShutdown()` crashes on host bots** - Called `instance.hunter.stop()` but host bots have no `hunter` property. Shutdown would crash per host bot, losing final stats. Now branches on `instance.isHost`.
- **`CommandQueue` created but never used** - Instantiated in `serverManager` but all commands used `bot.chat()` directly, bypassing rate limiting entirely. Wired `sendCommand()` helper for `/queue`, `/sethome`, `/home`. GUI-opening commands (`/rtp`, `/shop`, `/settings`, `/daily`) intentionally left direct for fast response.
- **Dead code in `doInitialShopping`** - Ternary `name === 'steak' ? x : 1` was inside `else if (name === 'steak')` block, making the `: 1` dead code. Simplified to just use the value directly.
- **`DEFAULT_CONFIG` missing fields** - `hostBot`, `maintenance`, `serverProfile`, `autoStart` were not in default config. Fresh installs would lack these fields. Added all missing fields.

### Added - Proxy Memory & Persistence
- **Proxy assignment memory** - Each bot slot remembers which proxy it used. On reconnect, the same proxy is reused unless it had a recent failure. Persisted to `data/proxyAssignments.json`.
- **Auto-start on launch** - Config option `"autoStart": true` to automatically start all bots when the process launches, instead of requiring manual start from the web dashboard.
- **Server chat relay** - Bot chat messages are relayed to the dashboard via SSE. New "Server Chat" box on the dashboard page shows live server chat from all bots.
- **Dashboard notification toasts** - In-browser toast notifications for key events: bot death (red), kick (yellow), player avoidance (yellow), cycle out (green). Auto-dismiss after 5s with slide animation.
- **Bot-to-bot item transfer** (`src/itemTransfer.js`) - TPA to another bot and drop items on the ground for pickup. Supports transferring spawners, pickaxes, totems between bots.
- **Spawner collection before cycle** - When a bot cycles out (spawner capacity full), it teleports home, then TPA's to an active bot and drops its spawners before disconnecting. Spawners are no longer lost on cycled accounts.

### Added - Safety & Operations
- **Command rate limiter** (`src/commandQueue.js`) - Queues chat commands with configurable min interval, burst allowance, and auto slow-down when server sends rate-limit messages. Prevents kicks from command spam.
- **Anti-captcha detection** (`src/antiCaptcha.js`) - Monitors chat for 14 known captcha/anti-bot patterns (text captcha, ClickVerify, slider, bot detection, rate limiting). Auto-responds to simple text captchas. Pauses bot and alerts on complex challenges.
- **Proxy health tracking** (`src/proxyManager.js`) - Tracks successes/failures per proxy. Auto-rotates to healthier proxy on repeated failures. Skips proxies with recent failures for 10 minutes.
- **Bot position trails** - Records last 100 positions per bot, draws purple trails on the map canvas for visual path tracking.
- **Scheduled maintenance restarts** - Configurable `maintenance.restartIntervalHours` to periodically restart bots. Staggered restarts with `staggerRestartMs` to avoid all bots reconnecting simultaneously.
- **Session state recovery** - Explorer saves direction/distance to `data/botStates.json`. On reconnect, resumes from saved position instead of starting fresh (if state < 30min old).

### Fixed - Bugs Found in Audit
- **CRITICAL: Bot stays dead permanently** - `bot.respawn()` was never called in death handler. Bot now respawns after 2s delay.
- **`this.totalBots` never assigned** - Explorer direction reset always divided by 1. Fixed constructor.
- **`const window` shadowed `let window`** in `disposeItems` - Catch block could never close the GUI window. Fixed variable declaration.
- **`BotCoordinator.getBotPositions()` static/instance mismatch** - Bot spacing never worked. Added static method.
- **Balance $0 rejected** - Bot couldn't track when broke. Changed `<= 0` to `< 0`.
- **`detect_and_respond` with `success_pattern` always timed out** - Never listened for success after responding. Fixed with separate success listener.
- **Multiple triggers firing for one message** - Added `responded` flag to stop after first match.

### Added - Scripting Agent & Shop Explorer
- **Server profile system** (`serverProfiles/default.json`) - JSON-driven configuration for any server. Defines login/register patterns, startup sequences, shop structure, commands, death recovery, survival params. Switch servers by changing one config line.
- **Script Engine** (`src/scriptEngine.js`) - Generic action executor supporting: chat, gui_click, gui_click_item, wait, wait_for_chat, wait_for_teleport, wait_for_window, detect_and_respond, if_has_item, if_balance, if_chat_matches, set_variable, try/catch, sequences, logging, retry. Variable interpolation with `{password}` syntax.
- **Shop Explorer** (`src/shopExplorer.js`) - Opens `/shop`, recursively maps all GUI categories and items. Extracts item names, display names, lore text, prices from NBT. Builds searchable database. Dynamic buying by keyword instead of hardcoded slot arrays.
- **Dynamic autobuy** - Economy module tries shop explorer's dynamic buy first (navigate GUI by discovered item path), falls back to hardcoded slot paths if exploration failed.
- **Profile-driven startup** - ServerManager runs profile's `startup_sequence` instead of hardcoded steps when a profile is loaded.
- **Profile-driven death recovery** - Configurable death recovery sequence per server profile.
- **Example profiles** - `serverProfiles/default.json` (lifesteal) and `serverProfiles/example-survival.json` (generic SMP).
- **Web API endpoints** - `GET /api/profile` (view current profile), `GET /api/shop-map` (view explored shop data), `POST /api/bot/:index/explore-shop` (trigger shop exploration).
- **Config: `serverProfile`** - Path to profile JSON in config.json.

### Added - Previous
- **Player avoidance: logout instead of flee** - When real players are detected nearby, the bot logs out for 2 hours instead of just fleeing. Bots recognize each other via global username registry and don't trigger avoidance.
- **Mob behavior: flee by default** - Bots now flee from hostile mobs instead of attacking. Only fight back when cornered (health < 5, mob within 2 blocks).
- **Smart RTP** - Auto-RTP only triggers when no spawners are nearby. If spawners are found during the RTP cooldown check, they get collected instead.
- **First-RTP spawn tolerance** - Player avoidance is disabled until after the first RTP completes, since spawn areas are always crowded.
- **Bot username registry** - Global set of active bot usernames so bots don't avoid/logout when they see each other. Registered on spawn, unregistered on cleanup.
- **Exponential backoff on reconnect** - Reconnect delay doubles on each failure: 30s -> 60s -> 120s -> 300s cap. Resets on successful spawn.
- **`/home` after death respawn** - Bots return to their hunting area after dying and respawning.
- **RTP retry with backoff** - RTP attempts up to 3 retries with increasing delay if the first attempt fails.
- **TPA status check** - Bots check if target bot is online before sending TPA request.
- **Proximity-based bot spacing** - Explorers nudge their direction away from other bots if within 100 blocks.
- **Scoreboard balance parsing** - Economy module now also parses balance from scoreboard sidebar updates.
- **Map legend** - Added color legend (red=found, green=mined, purple=bot) to the spawner map.
- **Web button debounce** - Bot action buttons disable for 3s after click to prevent spam.
- **Hunting loop variance** - Main loop sleep adds +/-30% random variance to avoid robotic timing.
- **Config: server password, death notifications, TPA toggle** - Added missing fields to web config form.
- **`avoiding_players` status badge** - New yellow badge in dashboard for bots in player-avoidance cooldown.

### Changed
- `botSurvival.js` - Entity monitor differentiates real players from bots, sets `shouldLogout` flag. Health monitoring now event-driven via `health` event with 10s polling fallback.
- `spawnerHunter.js` - Main loop checks `shouldLogout`, skips duplicate spawner scan in RTP block, uses `serverManager.claimDaily()` instead of inline GUI code.
- `index.js` - Registers/unregisters bot usernames; detects "Player avoidance" disconnect for 2-hour reconnect; exports exponential backoff failures tracking.
- `economy.js` - Balance parsing only accepts responses after `/bal` sent (`pendingBalance` flag). Added scoreboard listener.
- `smartInventory.js` - GUI windows are always closed on error (sell + dispose).
- `serverManager.js` - RTP retries up to 3 times with backoff on failure. Window close safety.
- `explorer.js` - Checks other bot positions every 10 steps and nudges away if too close.
- `logger.js` - Log file rotation: max 10MB per file, max 5 files, auto-cleanup of files older than 7 days.
- `webServer.js` - Exports `getBotStatuses()` for time-series balance tracking.

### Fixed
- **Time-series balance always 0** - `getAllBotStatuses()` was a placeholder returning `{}`. Now reads from actual web server statuses.
- **Balance parsing too broad** - Would parse `$` amounts from random chat. Now only parses after explicit `/bal` command.
- **Daily claim code duplication** - Removed inline daily-claim code from hunter loop, reuses `serverManager.claimDaily()`.
- **Double spawner scan** - Main loop scan now `continue`s past RTP block when spawners found, eliminating redundant second scan.
- **Missing config fields** - Added server password, death notification toggle, TPA toggle to web config form.

## [1.0.0] - Initial Release

### Core System
- Multi-bot architecture with configurable bot count
- Offline (cracked) and Microsoft authentication support
- SOCKS5 proxy support with round-robin assignment
- Realistic username generation (Markov chain + pattern mixing)
- Unique deterministic passwords per bot via SHA-256
- Graceful shutdown with state persistence

### Server Integration
- Auto login/register with prompt detection
- Server queue handling (`/queue lifesteal`) with position change detection
- Random teleport via GUI interaction (`/rtp`)
- Settings application (disable mob spawning)
- Daily reward claiming via GUI
- `/sethome` and `/home` support

### Economy
- Balance tracking from `/bal` chat output
- Shop GUI navigation for purchases (pickaxe, steak, totem)
- Balance verification before and after purchases

### Inventory Management
- Smart item categorization (keep tools/armor/food/spawners, sell/dispose rest)
- `/sellgui` integration for selling junk items
- `/disposal` fallback for unsellable items
- Automatic totem equipping in offhand
- Essentials auto-buy (pickaxe, food, totem)

### Spawner Hunting
- Block scanning via `bot.findBlocks()` within configurable radius
- Spawner type detection from block entity NBT
- Pathfinding navigation to spawner locations
- Auto-mine via mineflayer-collectblock
- Sector-based exploration with human-like movement
- Underground chunk loading via periodic digging
- Spawner capacity tracking with auto-cycle when full
- Replacement bot spawning on cycle

### Survival
- Health/food monitoring with auto-eat
- Anti-AFK via random camera movement + arm swing
- Stuck detection and recovery
- Player detection and avoidance (original: flee behavior)
- Hostile mob detection and response
- Dangerous block avoidance (lava, fire, cactus, etc.)
- XP tracking

### Bot Coordination
- Shared global state (cooldowns, positions, failures)
- TPA between bots with auto-accept
- Daily (24h) and RTP (5min) cooldown tracking
- Failure monitoring (auto-stop after 5 consecutive failures)

### State Persistence
- Spawner database with type, status, timestamps
- Explored chunk tracking
- Time-series snapshots every 60s (24h retention)
- Auto-save to `data/` directory
- CSV and JSON export

### Web Dashboard
- Dark-themed SPA with 7 pages (Dashboard, Bot Control, Map, Spawners, Economy, Config, Logs)
- Canvas-based spawner map with zoom/pan/drag
- Sortable/filterable spawner table
- Time-series chart
- Bot control: start/stop, generate usernames, action buttons
- Inventory modal with durability bars
- Health/food bars in bot cards
- SSE real-time updates
- Optional password authentication
- Rate limiting on API endpoints

### Notifications
- Discord webhook support
- Cycle, death, and kick notifications (configurable)

### Resilience
- Auto-reconnect on disconnect
- Banned detection (stops reconnecting)
- Server restart detection (faster 10s reconnect)
- Death recovery with re-equipping
- Kick reason parsing
