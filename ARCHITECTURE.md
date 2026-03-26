# Jurni — Architecture

## Overview

Jurni is an Electron desktop app with three layers: Ingestion, Processing, and Presentation. Everything runs locally. The only network calls are to OpenRouter for LLM analysis. All data lives in `~/.jurni/`.

## Project Structure

```
jurni-nuclear/
├── electron/           # Electron main process
│   ├── main.js         # Window management, IPC handlers, tray
│   ├── preload.js      # Context bridge (renderer ↔ main)
│   └── database.js     # SQLite wrapper with all queries
├── src/                # React frontend (Vite)
│   ├── main.jsx        # Entry point
│   ├── index.css       # Tailwind + custom styles
│   ├── App.jsx         # Root with routing + onboarding logic
│   ├── components/     # Shared UI components
│   │   ├── Sidebar.jsx
│   │   ├── ScoreRing.jsx
│   │   └── DimensionBars.jsx
│   └── screens/        # Page-level screens
│       ├── ScoreScreen.jsx   # "Whoop" home screen
│       ├── Timeline.jsx      # Chronological moment feed
│       ├── People.jsx        # Entity list + detail view
│       ├── Patterns.jsx      # Detected behavioral patterns
│       ├── Settings.jsx      # API key, import, data management
│       └── Onboarding.jsx    # "HER" welcome + setup flow
├── channels/           # Ingestion modules
│   ├── conversation.js    # Claude/ChatGPT JSON import parser
│   └── browser-preload.js # Injected into connector BrowserWindows (sniffer + crawler)
├── processing/         # LLM analysis pipeline
│   └── processor.js    # Single-prompt batch analysis via OpenRouter
├── scoring/            # Score engine
│   └── engine.js       # Pure math: 5 dimensions → 0-100 score
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Database Schema (SQLite at ~/.jurni/jurni.db)

- **moments** — Atomic unit. Every ingested piece of data (message, photo, event).
- **entities** — People, projects, places, topics extracted from moments.
- **patterns** — Recurring behaviors detected across moments.
- **emotions** — Emotional signals extracted per moment.
- **decisions** — Decisions discussed in conversations, tracked for loops.
- **scores** — Daily Life Recovery Score snapshots (overall + 5 dimensions).
- **config** — Key-value settings store.

## Data Flow

1. **Ingest** → User connects Claude/ChatGPT via browser connector OR imports JSON export → moments stored in SQLite
2. **Process** → Moments batched (20 at a time) → Single LLM prompt via OpenRouter → Emotions, entities, decisions, patterns extracted → stored in SQLite
3. **Score** → `scoring/engine.js` reads emotions, decisions, entities, moments → computes 5 dimension scores → overall 0-100
4. **Display** → React screens read via IPC + poll every 10s + listen for real-time events → ScoreRing, DimensionBars, Timeline, People, Patterns

## Onboarding Flow

1. **Welcome** — Cinematic tagline
2. **API Key** — OpenRouter key input
3. **Connect Sources** — Three connector cards (Claude, ChatGPT, Photos) + calendar coming soon. Each can toggle on a browser window or folder picker. Historical JSON import as secondary option.
4. **Discovering** — The "HER" moment. Live counters (moments, emotions, people, patterns), scrolling discovery log, animated score ring. Polls database every 2s. Score preview appears when ready.
5. **Dashboard** — Full app with sidebar nav. Score screen shows skeleton/loading state while data processes, updates in real-time.

## Score Dimensions (20 pts each, 100 total)

| Dimension    | What it measures                              |
|-------------|-----------------------------------------------|
| Emotional   | Positive-to-negative emotion ratio (7 days)    |
| Mental      | Open decision loops, indecision penalty        |
| Relational  | Social breadth + sentiment toward people       |
| Routine     | Activity time consistency across days          |
| Professional| Decision progress vs stagnation                |

## Design System

- **Fonts**: Playfair Display (display), DM Sans (body)
- **Colors**: Cream bg, terracotta accent, sage/amber secondary, charcoal text
- **Score colors**: Green (70+), Yellow (40-69), Red (0-39)

## Running

```bash
npm install
npx @electron/rebuild       # rebuild native modules for Electron
npm run dev                 # starts Vite + Electron concurrently
```

## Logging & Debugging

All crawler and main-process activity is logged to `~/.jurni/crawler.log`. The log file is truncated on each app start.

- **Main process** logs via `log(source, message, data)` — writes to file, console, and sends to renderer.
- **Browser preload** logs via `clog(message, data)` — sends to main via `crawler-log` IPC channel.
- **Renderer** receives real-time log entries via `onLogEntry` event.
- **Settings → Crawler Logs** shows a live terminal view of all log lines, with copy-to-clipboard support.
- You can also `tail -f ~/.jurni/crawler.log` in a terminal for real-time monitoring.

Every key step is logged: sniffer hits (org ID, endpoints, headers), API fetches (URL, status codes, response shapes), conversation counts, crawl progress, errors with stack traces, auto-processing batch sizes, LLM results, and score updates.

## MVP Status

- [x] Electron app shell with IPC
- [x] SQLite database with full schema
- [x] Claude/ChatGPT JSON import (historical data)
- [x] Live browser observation (BrowserWindow + network interception + DOM scraping)
- [x] Browser connector windows with persistent sessions (Claude, ChatGPT)
- [x] Visible status bar injected into browser ("Jurni is observing")
- [x] LLM batch processing via OpenRouter
- [x] Life Recovery Score engine (5 dimensions)
- [x] Score Screen with animated ring
- [x] Timeline, People, Patterns screens
- [x] Settings with import + API key management
- [x] Onboarding: Welcome → API Key → Connect Sources (3 cards) → Score Reveal
- [x] Menu bar tray icon
- [x] Full crawler logging (`~/.jurni/crawler.log` + in-app log viewer)
- [ ] Photo scanning channel (folder picker wired, scanning not yet implemented)
- [ ] Calendar integration (Google OAuth)
- [ ] .dmg packaging
