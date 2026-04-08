# MCBOT Feature List

## Core System
- [x] Multi-bot architecture with configurable bot count
- [x] Offline (cracked) and Microsoft authentication support
- [x] SOCKS5 proxy support with round-robin assignment
- [x] Realistic username generation (Markov chain + pattern mixing)
- [x] Unique deterministic passwords per bot via SHA-256
- [x] Graceful shutdown with state persistence
- [x] Auto-start on launch (`config.autoStart`)
- [x] Per-bot config overrides (`config.botOverrides`)
- [x] Shared utility module (`src/shared.js`)

## Server Integration
- [x] Auto login/register with prompt detection
- [x] Server queue handling (`/queue lifesteal`) with position change detection
- [x] Random teleport via GUI interaction (`/rtp`)
- [x] Settings application (disable mob spawning)
- [x] Daily reward claiming via GUI
- [x] `/sethome` and `/home` support
- [x] Server profile system (`serverProfiles/*.json`)
- [x] Script engine for generic action execution
- [x] Profile-driven startup and death recovery sequences
- [x] Command rate limiter (`src/commandQueue.js`)

## Economy
- [x] Balance tracking from `/bal` chat output
- [x] Scoreboard balance parsing
- [x] Shop GUI navigation for purchases (pickaxe, steak, totem)
- [x] Dynamic shop exploration and item mapping
- [x] Shop map persistence to disk
- [x] Balance verification before and after purchases
- [x] Dynamic autobuy via shop explorer with fallback to hardcoded slots

## Inventory Management
- [x] Smart item categorization (keep tools/armor/food/spawners, sell/dispose rest)
- [x] `/sellgui` integration for selling junk items
- [x] `/disposal` fallback for unsellable items
- [x] Automatic totem equipping in offhand
- [x] Essentials auto-buy (pickaxe, food, totem)
- [x] Inventory full detection (>= 35 slots)
- [x] Building block limit (max 192 kept)

## Spawner Hunting
- [x] Block scanning via `bot.findBlocks()` within configurable radius
- [x] Spawner type detection from block entity NBT
- [x] Pathfinding navigation to spawner locations
- [x] Auto-mine via mineflayer-collectblock
- [x] Sector-based exploration with human-like movement
- [x] Underground chunk loading via periodic digging
- [x] Spawner capacity tracking with auto-cycle when full
- [x] Replacement bot spawning on cycle
- [x] Death rate limiting (5 deaths in 10 min stops bot)
- [x] Density-based exploration bias toward spawner-rich areas

## Survival
- [x] Health/food monitoring with auto-eat
- [x] Event-driven health updates with 10s polling fallback
- [x] Anti-AFK via random camera movement + arm swing
- [x] Stuck detection and recovery
- [x] Player detection and avoidance (2-hour logout)
- [x] First-RTP spawn tolerance (no avoidance until first RTP done)
- [x] Hostile mob detection (30+ mob types) and flee behavior
- [x] Self-defense only when cornered (health < 5, mob within 2 blocks)
- [x] Dangerous block avoidance (lava, fire, cactus, etc.)
- [x] XP tracking

## Bot Coordination
- [x] Shared global state (cooldowns, positions, failures)
- [x] Shared event bus for inter-bot messaging (`botEvents`)
- [x] TPA between bots with auto-accept
- [x] Daily (24h) and RTP (5min) cooldown tracking
- [x] Failure monitoring (auto-stop after 5 consecutive failures)
- [x] Bot-to-bot item lending via `/msg [bot-msg]` protocol
- [x] Item transfer between bots via TPA + ground drop
- [x] Bot proximity-based spacing (explorer nudges away)
- [x] Global username registry (bots don't avoid each other)

## Host Bot System
- [x] Dedicated host bots that stay at `/home`
- [x] 1 host per 10 hunters (configurable ratio)
- [x] Auto-accept TPA from hunters
- [x] Spawner pickup and tracking
- [x] Shulker box storage pipeline (buy, place, fill, break, collect)
- [x] Round-robin hunter-to-host assignment
- [x] Host bot dashboard visibility with `[HOST]` tag

## Anti-Detection
- [x] Anti-detection module with humanized click/movement timing
- [x] Anti-captcha detection (14 patterns across common plugins)
- [x] Auto-respond to simple text captchas
- [x] Staff player detection by display name keywords
- [x] Global staff tracking across all bots
- [x] Staff alert banner on dashboard
- [x] Hunting loop variance (+/- 30% random sleep)
- [x] Proper listener cleanup on bot stop

## State Persistence
- [x] Spawner database with type, status, timestamps
- [x] Explored chunk tracking (packed integer format)
- [x] Time-series snapshots every 60s (24h retention)
- [x] Auto-save to `data/` directory
- [x] CSV and JSON export
- [x] Shop map persistence
- [x] Explorer state recovery (direction/distance saved to disk)
- [x] Proxy assignment memory
- [x] Smart scheduler state persistence

## Web Dashboard
- [x] Dark-themed SPA with 9 pages (Dashboard, Bot Control, Map, Spawners, Economy, Config, Accounts, Scheduler, Logs)
- [x] Canvas-based spawner map with zoom/pan/drag
- [x] Bot position trails on map
- [x] Sortable/filterable spawner table
- [x] Time-series chart
- [x] Bot control: start/stop, generate usernames, action buttons
- [x] Inventory modal with durability bars
- [x] Health/food bars in bot cards
- [x] Host bot cards with storage stats
- [x] SSE real-time updates with heartbeat
- [x] Optional password authentication
- [x] Rate limiting on API endpoints
- [x] Path traversal protection on file-access endpoints
- [x] Bulk bot actions (Daily All, RTP All, Clean Inv All)
- [x] Notification toasts with sound effects
- [x] Staff online alert banner
- [x] Server chat relay
- [x] Command history tracking
- [x] Health check endpoint (`/api/health`)

## Metrics & Scheduling
- [x] Per-bot performance metrics (spawners/hr, distance/hr, efficiency)
- [x] Performance leaderboard
- [x] Efficiency calculation (1h and 24h rates)
- [x] Smart scheduler with risk assessment
- [x] Activity-based intensity adjustment
- [x] Hourly activity patterns with persistence
- [x] Cron-like scheduled commands
- [x] Per-bot command targeting
- [x] Scheduled command persistence to config
- [x] Scheduled maintenance restarts with staggered timing
- [x] Pause hours (stop bots during configured hours, auto-restart)

## Notifications
- [x] Discord webhook support
- [x] Cycle, death, and kick notifications (configurable)

## Resilience
- [x] Auto-reconnect on disconnect
- [x] Exponential backoff (30s → 60s → 120s → 300s cap)
- [x] Banned detection (stops reconnecting)
- [x] Server restart detection (faster 10s reconnect)
- [x] Death recovery with re-equipping
- [x] Kick reason parsing
- [x] Proxy health tracking with auto-rotation
- [x] Proxy connection timeout (30s)
- [x] Double-cleanup guard (`cleanedUp` flag)
- [x] Global unhandled exception/rejection handlers

## Not Yet Implemented
- [ ] WebSocket alternative to SSE for bidirectional communication
- [ ] Metrics persistence across restarts
- [ ] Spawner race lock to prevent duplicate mining
- [ ] SSE endpoint auth protection
- [ ] Proxy latency-based rotation
- [ ] Account rotation
- [ ] Tab list staff detection
- [ ] Script pre-validation
- [ ] Potion effect handling in movement
- [ ] Custom username patterns
- [ ] Structured JSON log output
- [ ] Network latency metrics
