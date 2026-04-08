# MCBOT

Multi-bot Minecraft spawner hunting system with proxy support, web dashboard, and automated economy management.

## Features

- **Multi-bot orchestration** - Run multiple hunter bots + host bots with coordinated spawner collection
- **Automated spawner hunting** - Sector-based exploration, block scanning, pathfinding, and mining via mineflayer
- **SOCKS5 proxy support** - Round-robin proxy assignment with health checking and auto-rotation
- **Web dashboard** - Real-time monitoring with SSE updates, bot control, spawner map, economy tracking
- **Server profiles** - JSON-driven config for any server (login patterns, shop structure, commands)
- **Smart inventory** - Auto-sell junk, keep valuables, buy essentials, equip totems
- **Bot survival** - Health/food monitoring, player avoidance, hostile mob flee, anti-AFK
- **Staff detection** - Detects staff ranks in player names, triggers emergency logout
- **Item lending** - Bot-to-bot item sharing via in-game `/msg` protocol
- **Host bot system** - Dedicated bots that collect and store spawners in shulker boxes
- **Scheduled commands** - Cron-like command execution with per-bot targeting
- **Smart scheduler** - Risk assessment based on player activity patterns
- **Metrics** - Per-bot spawners/hr, distance/hr, efficiency tracking
- **Discord webhooks** - Notifications for deaths, kicks, bot cycles

## Quick Start

```bash
npm install
cp config.example.json config.json
# Edit config.json with your server details
npm start
```

Open `http://localhost:3000` for the dashboard.

## Configuration

Copy `config.example.json` to `config.json` and configure:

| Setting | Description |
|---------|-------------|
| `server.host` | Minecraft server address |
| `server.version` | Minecraft version (e.g. `1.21.1`) |
| `botCount` | Number of hunting bots |
| `authMode` | `offline` or `microsoft` |
| `webPort` | Dashboard port (default 3000) |
| `webPassword` | Optional dashboard auth |
| `serverProfile` | Path to server profile JSON |

See `serverProfiles/default.json` for an example server profile.

## Proxies

Create `proxies.txt` with one proxy per line:
```
ip:port
ip:port:username:password
```

## Accounts

For Microsoft auth mode, create `accounts.json`:
```json
{
  "accounts": [
    { "email": "bot1@example.com", "password": "pass1" }
  ]
}
```

## Architecture

```
src/
  index.js          - Main entry, bot lifecycle management
  bot.js             - Bot creation (direct + SOCKS5 proxy)
  spawnerHunter.js   - Core hunting loop
  explorer.js        - Sector-based area exploration
  botSurvival.js     - Health, food, player avoidance, anti-AFK
  serverManager.js   - Server-specific init sequences
  economy.js         - Balance tracking, shop purchases
  smartInventory.js  - Inventory categorization, sell/dispose
  hostBot.js         - Host bot spawner storage
  botCoordinator.js  - Inter-bot communication, TPA, cooldowns
  webServer.js       - Express API + SSE dashboard backend
  spawnerStore.js    - Spawner/chunk/time-series persistence
  scriptEngine.js    - Generic action executor for profiles
  shopExplorer.js    - Dynamic shop GUI mapping
  commandQueue.js    - Rate-limited command sending
  antiDetection.js   - Humanized click/movement timing
  antiCaptcha.js     - Captcha pattern detection
  scheduledCommands.js - Cron command execution
  smartScheduler.js  - Activity-based risk scheduling
  botMetrics.js      - Per-bot performance metrics
  itemLending.js     - Bot-to-bot item sharing
  itemTransfer.js    - TPA-based item transfer
  proxyManager.js    - Proxy loading, health, rotation
  accountManager.js  - Credential generation/management
  logger.js          - File logging with rotation
  utils.js           - Shared utilities
  shared.js          - deepMerge utility
  usernameGenerator.js - Realistic name generation
public/
  index.html         - Single-page dashboard
serverProfiles/
  default.json       - Example lifesteal profile
  example-survival.json - Example SMP profile
```

## License

MIT
