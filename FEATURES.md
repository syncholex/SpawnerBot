# MCBOT Feature List

## Scripting Agent (Server-Agnostic System)

### Server Profiles (`serverProfiles/`)
- **JSON-driven server profiles**: Define all server-specific behavior in a profile file
- **Login/register patterns**: Configurable detect patterns, commands, success patterns
- **Startup sequences**: Array of actions (chat, gui_click, wait_for_chat, wait_for_teleport, etc.)
- **Death recovery sequences**: Per-server respawn behavior
- **Shopping config**: Item keywords, max prices, priorities, quantities
- **Command mappings**: Map `/bal`, `/home`, `/sell` etc. for any server
- **Survival params**: Configurable dangerous blocks, avoid distances, fight thresholds
- **Example profiles**: Default lifesteal profile + generic SMP example

### Script Engine (`src/scriptEngine.js`)
- **18 action types**: chat, gui_click, gui_click_item, gui_close, wait, wait_for_chat, wait_for_teleport, wait_for_window, detect_and_respond, if_has_item, if_balance, if_chat_matches, set_variable, try/catch, retry, log, sequence, generic action dispatch
- **Variable interpolation**: `{password}`, `{balance}`, custom vars in all commands
- **Conditional branching**: if_has_item, if_balance, if_chat_matches with then/else blocks
- **Error handling**: try/catch blocks, optional actions, retry support
- **Composable**: Sequences can nest sequences

### Shop Explorer (`src/shopExplorer.js`)
- **Recursive GUI mapping**: Opens shop, clicks into every slot, discovers sub-categories
- **Item metadata extraction**: Names, display names, lore text, NBT data
- **Price parsing**: Extracts prices from lore (dollar amounts, "Price: X", "Cost: X")
- **Searchable database**: Find items by keyword across all categories
- **Dynamic buying**: Navigate to item using discovered path instead of hardcoded slots
- **Fallback**: Gracefully falls back to configured slot paths if exploration fails
- **Web API**: `/api/shop-map` to view data, `/api/bot/:index/explore-shop` to trigger

## Core System
- **Multi-bot architecture**: Run N bots simultaneously, each on its own slot index
- **Offline (cracked) + Microsoft auth**: Configurable auth mode per deployment
- **SOCKS5 proxy support**: Assign proxies round-robin to avoid IP bans (`proxies.txt`)
- **Unique deterministic passwords**: SHA-256 hash per username so login/register is consistent across reconnects
- **Realistic username generation**: Markov-chain style names (adjective+noun, prefix+name, l33t speak, etc.)
- **Graceful shutdown**: SIGINT/SIGTERM handler saves state and disconnects all bots cleanly

## Server Integration (serverManager.js)
- **Auto login/register**: Detects login/register prompts, sends `/l <pass>` or `/r <pass> <pass>`
- **Server queue**: Sends `/queue lifesteal`, detects teleport into game world via position change + chat
- **Random teleport (RTP)**: Opens `/rtp` GUI, clicks configured slot, waits for position change
- **Settings**: Applies `/settings` mob spawn disable via GUI click
- **Daily reward**: Claims `/daily` reward via GUI click
- **Set home / Go home**: `/sethome` after RTP, `/home` to return

## Economy (economy.js)
- **Balance tracking**: Parses `/bal` chat output and scoreboard updates
- **Shop purchases**: Multi-slot click path through `/shop` GUI (pickaxe, steak, totem)
- **Balance verification**: Refreshes balance before and after purchases
- **Cost checks**: Skips purchases if balance is insufficient

## Smart Inventory (smartInventory.js)
- **Item categorization**: Keep (spawners, tools, armor, food, totems, ender pearls, building blocks), Sell (everything else)
- **Sell via `/sellgui`**: Shift-clicks items into sell GUI, falls back to `/disposal` if sell fails
- **Disposal via `/disposal`**: Disposes of unsellable overflow items
- **Totem offhand**: Automatically equips totem in off-hand slot
- **Essentials auto-buy**: Buys pickaxe, food, totem when missing during inventory management
- **Building block cap**: Keeps up to 192 building blocks, sells excess

## Spawner Hunting (spawnerHunter.js)
- **Block scanning**: Uses `bot.findBlocks()` to locate spawner blocks within configurable distance
- **Spawner type detection**: Reads block entity NBT data to identify mob type (zombie, skeleton, blaze, etc.)
- **Pathfinding navigation**: Uses mineflayer-pathfinder GoalBlock to navigate to spawners
- **Auto-mine via collectblock**: Uses mineflayer-collectblock plugin to mine spawners
- **Sector-based exploration**: Each bot explores a different angular sector of the search area
- **Human-like movement**: Varied step sizes (20-40 blocks), random pauses, occasional camera rotation
- **Underground chunk loading**: Periodically digs down to load sub-surface chunks for scanning
- **Per-type capacity tracking**: Tracks spawner counts; cycles bot out when capacity reached
- **Auto-cycler**: When spawner capacity full, disconnects bot and spawns replacement with fresh username

## Survival (botSurvival.js)
- **Health/food monitoring**: Polls every 3s, auto-eats when food or health drops below threshold
- **Anti-AFK**: Random camera rotation + arm swing on configurable interval
- **Stuck detection**: Tracks position delta, triggers recovery if stuck for N ticks
- **Stuck recovery**: Jumps, walks forward, then pathfinds to random nearby position
- **Player avoidance**: Detects real players within configurable radius, logs out for 2 hours
- **Bot self-recognition**: Bots don't flee/logout when they see other bots (via global username registry)
- **Spawn-area tolerance**: Skips player detection before first RTP completes (spawn is always crowded)
- **Mob flee**: Runs away from hostile mobs within 8 blocks
- **Cornered self-defense**: Only fights back if health < 5 AND mob within 2 blocks
- **Dangerous block avoidance**: Checks for lava, fire, cactus, sweet berry bush, wither rose near targets
- **XP tracking**: Listens for experience events, tracks level and progress

## Bot Coordination (botCoordinator.js)
- **Global state sharing**: Shared cooldowns, positions, failure counts across all bots
- **Daily cooldown**: 24h cooldown per bot, tracked globally
- **RTP cooldown**: 5min cooldown per bot
- **Failure monitoring**: Auto-stops bot after 5 consecutive failures
- **TPA between bots**: Bots can `/tpa` to each other and auto-accept with human-like delay
- **Position tracking**: Each bot reports its X/Z position for coordination
- **Bot username registry**: Global set of active bot usernames for self-recognition

## State Persistence (spawnerStore.js)
- **Spawner database**: Tracks every found/mined spawner with coords, type, status, timestamps
- **Chunk tracking**: Records explored chunks to avoid redundant scanning
- **Time-series data**: Snapshots every 60s (bots online, balance, found/mined counts) up to 24h
- **Auto-save**: Saves to `data/` directory every 60s
- **CSV/JSON export**: Export spawner data via API

## Web Dashboard (public/index.html)
- **Dark-themed SPA**: Sidebar nav with 7 pages
- **Dashboard**: Overview stats, spawner type breakdown, time-series chart, active bot cards
- **Bot Control**: Start All/Stop All, generate usernames, start/stop individual bots, action buttons
- **Spawner Map**: Canvas-based map with zoom/pan, spawner dots (red=found, green=mined), bot positions, explored chunk overlay
- **Spawner Database**: Sortable/filterable table with search, status/type filters, "view on map" button
- **Economy**: Balance overview, per-bot economy cards with quick buy buttons
- **Config**: Editable form for all config sections, saves via API
- **Logs**: Per-bot log viewer with tab selection, auto-scroll
- **Inventory modal**: View bot inventory with durability bars and color-coded items
- **Health/food bars**: Inline colored bars in bot cards
- **SSE real-time updates**: Server-Sent Events push status changes without polling
- **Optional password auth**: Login screen if `webPassword` is set

## Web API (webServer.js)
- **RESTful endpoints**: `/api/stats`, `/api/spawners`, `/api/bots`, `/api/config`, etc.
- **Bot control**: POST endpoints for start/stop, daily, RTP, buy items, clean inventory, send commands
- **SSE endpoint**: `/sse` for real-time status push
- **CSV export**: `/api/export/csv` for spreadsheet import
- **Rate limiting**: 150ms between requests per IP+path
- **Password auth**: Bearer token or query param, GET exempted for SSE/static

## Webhooks & Notifications
- **Discord webhooks**: Configurable URL for notifications
- **Cycle notification**: Alerts when bot cycles out due to spawner capacity
- **Death notification**: Alerts when bot dies (optional)
- **Kick notification**: Alerts when bot is kicked with reason

## Logging (logger.js)
- **Winston-based**: Structured logging with timestamps
- **Per-bot log files**: Each bot gets its own log file
- **Console + file output**: Colorized console, plain text files
- **Configurable level**: Set via config.json

## Resilience
- **Auto-reconnect**: Reconnects on disconnect with configurable delay
- **Exponential backoff**: Not yet implemented (TODO)
- **Banned detection**: Parses kick reasons, stops reconnecting if banned
- **Server restart detection**: Faster 10s reconnect if server is restarting
- **Player avoidance reconnect**: 2-hour delay when logging out due to real player detection
- **Death recovery**: Re-equips and re-manages inventory after auto-respawn
