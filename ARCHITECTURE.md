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
│   │   ├── DimensionBars.jsx
│   │   └── landscape/       # Life Landscape subcomponents
│   │       ├── Tile.jsx         # Treemap tile with progressive disclosure
│   │       ├── DrillDrawer.jsx  # Drill-down drawer (stories + people)
│   │       └── Scrubber.jsx     # Week-by-week timeline scrubber
│   ├── lib/
│   │   ├── squarify.js          # Squarified treemap layout algorithm
│   │   └── landscape-theme.js   # Category → color palette mapping
│   └── screens/        # Page-level screens
│       ├── LifeLandscape.jsx # The app. Treemap with 4 group modes (topic, domain, people, time)
│       ├── Settings.jsx      # API key, import, models, pins-agnostic utility screen
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

- **moments** — Atomic unit. Every ingested piece of data (message, photo, event). Includes landscape fields: `topic`, `category`, `tone`, `summary`.
- **entities** — People, projects, places, topics extracted from moments.
- **patterns** — Recurring behaviors detected across moments.
- **emotions** — Emotional signals extracted per moment.
- **decisions** — Decisions discussed in conversations, tracked for loops.
- **scores** — Daily Life Recovery Score snapshots (overall + 5 dimensions).
- **config** — Key-value settings store.
- **pins** — User-marked tiles surfaced in the sidebar. `UNIQUE(tile_key, group_mode)` because the same label can mean different things across modes (a topic vs a person).

### Landscape fields on `moments`

| Field    | Purpose                                                    |
|----------|------------------------------------------------------------|
| topic    | Specific named subject (proper noun): "Clinera", "Yara"   |
| category | Fixed bucket: work, money, love, family, child, peers, faith, body, mind, craft, public, hearth, grief, other |
| tone     | One-word felt quality: open, tense, stuck, alive, waiting |
| summary  | One-sentence summary of what the message is really about  |

## Data Flow

Two independent LLM passes run against ingested moments. Each uses its own
configurable model (see AI Models below):

1. **Ingest** → User connects Claude/ChatGPT via browser connector OR imports JSON export → moments stored in SQLite with `conversation_name` in metadata
2. **Analysis pass** (per message, cheap model) → Moments batched (20 at a time) → `processBatch()` calls the **analysis model** → Emotions, entities, decisions, patterns extracted → stored in SQLite
3. **Categorization pass** (per thread, quality model) → `runThreadCategorization()` groups moments by `conversation_name`, sends each thread (title + first 8 + last 4 messages) to the **landscape model** → Returns ONE `{topic, category, tone, summary}` for the whole conversation → applied to every moment in that thread
4. **Score** → `scoring/engine.js` reads emotions, decisions, entities, moments → computes 5 dimension scores → overall 0-100
5. **Aggregate** → `getLandscape({ range, group, weekOffset })` groups moments by topic, picks the most-common category per topic, computes change-vs-previous-period and 12-bucket sparkline
6. **Display** → React screens read via IPC + poll every 10s + listen for real-time events → LifeLandscape, Timeline, People, Patterns

Why two passes? Per-message categorization fragments context — the LLM sees
message 3 of a 40-message thread and invents a topic like "Contract Options",
then sees message 7 and invents "Contract Negotiation" for the same thread.
Thread-level categorization eliminates this repetition and produces the
accurate, consistent topic names that the Life Landscape depends on.

### AI Models (configurable)

Two separate model slots, each set via `Settings → AI Models` and stored in
the `config` table:

| Config key         | Purpose                          | Default               | Cost per call |
|--------------------|----------------------------------|-----------------------|---------------|
| `landscape_model`  | Thread categorization (the core) | `google/gemini-2.5-flash` | ~$0.0003 |
| `analysis_model`   | Per-message emotions/patterns    | `mistralai/mistral-small-2603` | ~$0.00005 |

The list of selectable models lives in `AVAILABLE_MODELS` in `electron/main.js`
and is surfaced to the UI via `get-available-models` IPC. Add new models there.

### Ingestion deduplication

Every row in `moments` carries a `content_hash` (first 16 chars of SHA-1 over
`raw_content`) and we enforce `UNIQUE(source, timestamp, content_hash)`.
`db.insertMoment(moment)` uses `INSERT OR IGNORE` and returns
`{ id, inserted }` — callers decide whether to run downstream work based on
whether the write actually happened.

This makes the Claude crawler idempotent. The preload script still maintains
an in-memory `capturedHashes` set to avoid redundant IPC during a single
crawl, but that's an optimization; the DB is the source of truth for
"have we seen this message before?" across restarts and re-crawls.

Manual sync uses this: `sync-provider` opens a hidden connector window,
drives the crawler, and tallies `added` vs `skipped` by inspecting the
`inserted` flag on each `insertMoment` call. The renderer sees progress
via the `sync-progress` event.

### Per-tile briefing (on-demand)

A third, lightweight LLM pass runs **only** when the user opens a drill drawer on
the Life Landscape. Produces a contextual summary tailored to the tile's category.

- **Trigger:** user clicks a tile → `DrillDrawer` mounts → parallel fetch of
  `get-tile-detail` (the stories) and `get-tile-briefing` (the briefing).
- **Input:** tile meta + top 8 stories (summary, tone, date) + top 8 people.
- **Output schema:**
  ```
  { briefing, state, trajectory,
    // optional, category-specific:
    key_figures[], next_move, blockers[], metrics[],
    open_questions[], themes[], last_touchpoint, temperature }
  ```
- **Prompt branches by category** — money asks for concrete numbers, work asks
  for next_move + blockers, body asks for metrics/streaks, mind asks for open
  questions + themes, people-categories (peers/family/love/child/hearth) ask
  for last_touchpoint + temperature.
- **Cache:** in-memory `Map` in main process, keyed by `group::key::start::end`,
  TTL 1h, cleared on every `landscape-updated` event. Evaporates on restart
  (acceptable — ~2s regen cost).
- **Graceful degradation:** if no API key, no stories, or LLM error, handler
  returns `null` and the drawer renders exactly as before. Fully additive.
- **Model:** reuses `landscape_model` config (default Gemini 2.5 Flash).
- **Cost:** ~500 in / 200 out tokens per unique tile view, cached on first open.

### Thread categorization in detail

`getUncategorizedThreads()` returns conversation threads where at least one
moment still lacks a category. `categorizeThread()` samples the thread (title
+ first 8 + last 4 messages, each capped at 400 chars — total prompt ~2k
tokens regardless of thread size), includes the top 40 known topics for
consistent naming, and asks for a single proper-noun topic + category + tone
+ summary. `applyThreadCategorization()` writes the result to every moment
in the thread. A scheduler runs categorization automatically after every
analysis batch and on app startup if there's a backlog.

## Onboarding Flow

1. **Welcome** — Jurni logo + italic-serif tagline on the app shell (same CSS variables as the landscape so the transition into the app is seamless).
2. **API Key** — OpenRouter key input. **Validated via `validate-openrouter-key` IPC** (hits `GET https://openrouter.ai/api/v1/auth/key`) before the key is persisted. Invalid/revoked/typo'd keys surface an inline error; a successful check shows the key label and remaining credit.
3. **Identity** — Name + aliases (required). Persisted via `set-user-identity` so the user isn't extracted as a stranger in their own conversations.
4. **Connect Sources** — Three connector cards (Claude, ChatGPT, Photos) + calendar coming soon. Each can toggle on a browser window or folder picker. Historical JSON import as secondary option inside each card.
5. **Discovering** — Live counters (moments, emotions, people, patterns), scrolling discovery log, animated score ring. Polls database every 2s. Score preview appears when ready.
6. **Dashboard** — Full app with sidebar nav. Score screen shows skeleton/loading state while data processes, updates in real-time.

All steps render on `var(--shell)` with `var(--surface)` cards, Georgia-italic headings and DM Sans body text — no Tailwind palette classes — so light/dark theming works from the first frame.

## Score Dimensions (20 pts each, 100 total)

| Dimension    | What it measures                              |
|-------------|-----------------------------------------------|
| Emotional   | Positive-to-negative emotion ratio (7 days)    |
| Mental      | Open decision loops, indecision penalty        |
| Relational  | Social breadth + sentiment toward people       |
| Routine     | Activity time consistency across days          |
| Professional| Decision progress vs stagnation                |

## Design System

- **Fonts**: Playfair Display (display), Georgia (serif in Landscape), DM Sans (body)
- **Theme tokens** in `src/index.css`: `--shell`, `--surface`, `--text-primary`, `--text-muted`, `--border`, `--accent`, `--hover-overlay` and a few soft-accent variants. Defined under `[data-theme="light"]` (default, warm cream like Claude's light mode) and `[data-theme="dark"]` (warm brown). Toggled via `data-theme` on `<html>`; persisted in `localStorage["jurni_theme"]`. The whole shell (sidebar, landscape frame, drill drawer, scrubber, settings panel) reads from these tokens — only tile category colors stay hardcoded because they encode data, not chrome.
- **Landscape**: Edge-to-edge surface that fills the viewport (no more "card on page" look). Italic serif narrative acts as the hero — when no narrative is ready, a time-anchored greeting takes its place so the top is never empty. Each life category has its own warm-earth gradient (see `src/lib/landscape-theme.js`). Small tiles use flat fills; large tiles use gradients. Sparklines, italic serif for topic names.
- **Sidebar**: Pure chrome — Jurni wordmark (returns to landscape), pinned list, theme toggle (Sun/Moon), Settings. No traditional nav items.
- **Score colors** (legacy): Green (70+), Yellow (40-69), Red (0-39)

### Tile chat

Each tile can be chatted with: an open-ended conversation scoped to that
tile's moments, people, and briefing. Lives at the bottom of the drill
drawer.

- **Prompt**: a system message injects the tile metadata, top 12 stories,
  top 10 people, and the cached briefing (if any). User's messages + the
  last 20 turns are appended as the conversation history.
- **IPC**: `chat-with-tile` handler takes `{ key, group, range, weekOffset,
  messages }` and returns `{ ok, reply, error }`. No streaming yet; the
  whole response arrives at once. Typing indicator while waiting.
- **Model**: `landscape_model` (Gemini Flash by default) at temp 0.4,
  max 700 tokens.
- **Persistence**: in-memory per-drawer only. Closing the drawer wipes
  the chat. Re-opening the same tile starts fresh. A `tile_chats` table
  is easy to add later when persistence is desired.
- **Empty state**: category-aware suggestion chips ("What's my next move?",
  "What's blocking progress?", etc.) so the user isn't staring at a box.
- **Graceful degradation**: disabled when tile has no stories, or when no
  API key is set. The input shows the reason in its placeholder.

### Focused pin view

Clicking a pin in the sidebar opens that tile in a focused view: the
drawer only, no landscape behind it. A "← Landscape" pill returns to
the full view. Clicking a tile inline from the treemap stays in the
standard side-by-side mode. The distinction is about intent: pins are
"I know what I want", tile clicks are "I'm exploring".

### Pins

A pin is "this tile in this view I want to come back to." Stored in the
`pins` table keyed by `(tile_key, group_mode)`. The same label can appear
in multiple group modes (e.g. "Clinera" as a topic vs a person) — pins
respect that so you can bookmark both independently.

- **Toggle**: pin button sits in the drill drawer header, right before the
  close X. Filled when pinned, outline otherwise.
- **Sidebar**: `pins` state lives in `App.jsx`, loaded via `getPins` on
  mount and re-loaded whenever the main process emits `pins-changed`.
- **Open flow**: clicking a pin in the sidebar calls `onOpenPin(pin)` which
  sets `pinToOpen` in App state. `LifeLandscape` watches for it, switches
  `group` mode if the pin was created in a different mode, and sets the
  tile active so the drawer opens. Once the landscape data refreshes the
  active tile's stats upgrade to the full tile object.
- **IPC**: `get-pins`, `add-pin`, `remove-pin` + a `pins-changed` broadcast
  so every window stays in sync.

### Life Landscape UX rules

- Treemap uses the **squarify** algorithm (Bruls, Huijbregts, van Wijk) for good aspect ratios. Tiles reflow smoothly via framer-motion `layout` prop when range/group/week changes.
- **Progressive disclosure by tile area**: large tiles show category label + topic name (serif) + summary + change% + sparkline; medium tiles drop summary + sparkline; small tiles collapse to inline category + topic + change symbol.
- **Drill-down**: clicking a tile dims others (0.38 opacity + desaturation), opens a bottom drawer with the top 6 story summaries + people co-mentioned.
- **Scrubber**: 12 weeks back by default. Moving it anchors the active window to a different point in time. Caption + tiles reflow as the window slides.
- **Caption**: one sentence narrated locally (dominant topic + top riser + top faller). Intentionally terse, italic serif, contemplative tone. No LLM call per view — that stays cheap and instant.

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
- [x] Two-pass LLM processing: per-message analysis (cheap model) + per-thread categorization (quality model)
- [x] Configurable models via Settings → AI Models (Gemini Flash, Claude Sonnet, GPT-4o, Mistral Small)
- [x] Life Recovery Score engine (5 dimensions)
- [x] **Life Landscape dashboard** — squarified treemap of life topics with weekly scrubber and drill-down drawer
- [x] Thread-level deduplication in drill-down (one row per conversation, not per message)
- [x] Auto-scheduled thread categorization on startup + after every analysis batch
- [x] **Per-tile LLM briefing** — on drawer open, one LLM call produces a 2-4 sentence "what's going on" + category-specific fields (key figures for money, metrics for body, open questions for mind, blockers/next move for work, last touchpoint for peers/family). In-memory cache, cleared on landscape-updated.
- [x] User identity resolution foundation — name + aliases in Settings/Onboarding; user filtered from entities, topics, and People landscape. Email-shaped names blocked from being stored as person entities.
- [x] **Idempotent ingestion** — `moments` has a `content_hash` column and a `UNIQUE(source, timestamp, content_hash)` index. `insertMoment` uses `INSERT OR IGNORE` and returns `{id, inserted}`. Re-running the Claude crawler is now safe: duplicates are skipped at the DB layer, never counted, never re-processed. First-time migration backfills hashes on every existing row and deletes dupes (cleaning up orphaned emotions as it goes).
- [x] **Manual "Sync now"** — Settings → Sync Conversations exposes a per-provider Sync button. Spawns a hidden connector window in the persistent login partition, lets the existing crawler run, and reports +N new / M already-had via a live `sync-progress` IPC channel. 5-minute hard timeout. One active session per provider at a time.
- [x] **Pinning** — pin any tile from its drill drawer, revisit instantly from the sidebar. Cross-mode (topic vs person vs time) aware. Survives restarts via the `pins` table.
- [x] **Tile chat** — conversational Q&A inside each drill drawer. LLM sees the tile's stories + people + briefing as context, answers in free text. Category-aware suggestion prompts when the chat is empty. In-memory per-drawer history (no persistence yet).
- [x] **Focused pin view** — clicking a pin in the sidebar opens the tile in a drawer-only view (no landscape behind). Back button returns to full landscape.
- [x] **Theme toggle** — warm light (default) / warm dark, flipped via CSS variables. Whole shell re-palettes in one click. Persisted in localStorage.
- [x] **Shell simplification** — removed Timeline, People, Patterns screens. Landscape is the app; its grouping modes (Topics, Domains, People, Timeline) cover what those screens used to do.
- [x] Settings with import + API key management
- [x] Onboarding: Welcome → API Key → Connect Sources (3 cards) → Score Reveal
- [x] Menu bar tray icon
- [x] Full crawler logging (`~/.jurni/crawler.log` + in-app log viewer)
- [ ] Photo scanning channel (folder picker wired, scanning not yet implemented)
- [ ] Calendar integration (Google OAuth)
- [ ] .dmg packaging
