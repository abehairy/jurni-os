# Jurni Architecture

## Product Shape

Jurni is a local-first Electron app that turns personal data streams into a life dashboard.
There is no Jurni backend. Data lives on-device in `~/.jurni/`.

Core runtime layers:

1. **Ingestion**: connectors capture/source data (browser, file import, local folders).
2. **Processing**: LLM + deterministic scoring pipeline.
3. **Presentation**: React treemap/landscape UI with drill and chat.

## Runtime Topology

- **Main process**: `electron/main.js`
  - window lifecycle
  - connector windows
  - IPC handlers
  - orchestration for capture/import/sync
- **Renderer**: `src/*`
  - onboarding and settings
  - landscape and drill UI
- **Database**: `electron/database.js`
  - SQLite schema and query surface
- **Connector code**:
  - browser crawler: `channels/browser-preload.js`
  - export parser: `channels/conversation.js`
  - browser connector metadata: `electron/connectors/registry.js`

## Data Model

Primary table is `moments`:

- `timestamp`
- `source` (`conversation`, `photo`, `calendar`) — the broad ingestion bucket
- `kind` (`dialogue`, `post`) — what the content IS; drives pipeline routing
- `author` (`self`, `other`) — who wrote it; drives entity weighting
- `raw_content`
- `metadata` (JSON payload, provider-specific)
- landscape fields (`topic`, `category`, `tone`, `summary`) — only populated for `kind='dialogue'`

`kind` and `author` are indexed columns, not JSON extracts, so routing queries
stay fast. Behavior attached to each kind lives in `processing/kinds.js` as a
lookup table (KIND_PROFILES) — the pipeline never branches on provider.

Dedup is enforced by:

- `content_hash` on `raw_content`
- unique index: `(source, timestamp, content_hash)`
- idempotent write path via `INSERT OR IGNORE`

This makes re-sync and re-crawl safe.

## Connector Architecture (Current)

### Connector types

- **Browser connectors**: Claude, ChatGPT, X, LinkedIn, Instagram, Facebook
- **Folder connector**: Photos folder picker
- **Import connector**: JSON file import for historical Claude/ChatGPT data

### Browser connector registry

`electron/connectors/registry.js` is the single backend source of truth for:

- connector id
- start URL
- sync support
- import support
- `kind` (`dialogue` | `post`) — controls downstream pipeline routing

This keeps `main.js` simple and removes provider-specific branching. Adding a
new connector is: one registry row + one row in `processing/kinds.js` if it's
a new kind.

### Browser capture flow

1. Renderer asks main to `open-connector` or `sync-provider`.
2. Main opens a provider-scoped persistent BrowserWindow partition (`persist:<provider>`).
3. `channels/browser-preload.js` runs inside that window.
4. Preload detects provider and runs provider-specific crawl path:
   - Claude/ChatGPT: sniff + API crawl + sidebar fallback + live capture
   - Social feeds: visible feed scan capture path
5. Captured entries are sent via `conversation-message` IPC.
6. Main inserts into `moments`, emits `connector-status` and `sync-progress`.

### Status contract

UI consumes connector states from IPC events:

- `connecting`
- `navigating`
- `loaded`
- `crawling`
- `capturing`
- `disconnected`
- `crawl_complete`
- `crawl_error`

Onboarding and Settings both use this model for a seamless connector UX.

## Processing Pipeline

Every moment carries a `kind`. The pipeline is a dispatcher over KIND_PROFILES
(`processing/kinds.js`) — never an `if (provider === ...)`.

```
INGEST      → moment { source, kind, author, ... }
                 kind derived from connectors/registry.js
                 author set by preload (self/other)
                    │
PROCESS     → groupMomentsByProfile(batch)   // split by (kind, author)
               for each sub-batch:
                 profile = KIND_PROFILES[kind]
                 analysis = processBatch(sub-batch)
                 upsertEntity(mention_count × (author=self ? profile
                              .selfMentionWeight : 1))
                    │
CATEGORIZE  → only kinds where profile.categorizeInto === 'thread'
                 getUncategorizedThreads WHERE kind='dialogue'
                 one LLM call per conversation_name
                 writes topic/category/tone/summary back to its moments
                    │
SCORE       → computeScores(db) → moments + entities
                    │
LANDSCAPE UI reads moments + entities. Posts contribute via entities
            (people/places/projects); they have NULL topic/category by
            design — they never needed a thread label.
```

### KIND_PROFILES today

| kind       | categorizeInto | selfMentionWeight | Used by                            |
|------------|----------------|-------------------|------------------------------------|
| `dialogue` | `thread`       | `1`               | Claude, ChatGPT, JSON imports      |
| `post`     | `moment`       | `3`               | X, LinkedIn, Instagram, Facebook   |

Adding `event` (calendar), `photo`, or `note` (Notion/Obsidian) = add a row
here + an entry in `registry.js`. The pipeline picks up the behavior for free.

### Why `post` skips thread categorization

A "thread" only makes sense for back-and-forth chat. Social feeds would
otherwise be bucketed under one fake `conversation_name` (e.g. `"X Feed"`)
and forced through a single LLM call asking for ONE topic for 300 unrelated
posts — producing garbage labels that corrupted the domain donut and
briefings. Posts now stand alone; their signal comes through entities.

## UI Surfaces

- **Onboarding** (`src/screens/Onboarding.jsx`)
  - API key
  - identity
  - connector setup
  - discovery counters
- **Settings** (`src/screens/Settings.jsx`)
  - model choices
  - manual sync per connector
  - import/export/reset
  - live logs
- **Landscape** (`src/screens/LifeLandscape.jsx`)
  - treemap by topic/domain/people/time
  - drawer drill
  - tile chat

## Distribution & Auto-Update

Jurni ships as a signed + notarized macOS DMG and auto-updates via
`electron-updater`.

```
[dev machine]                    [GitHub]                    [user's Mac]
  npm run release                                             Jurni (running)
    │                                                              │
    ├─ vite build                                                  │
    ├─ electron-builder                                            │
    │    - sign (Developer ID)                                     │
    │    - notarize (Apple)          GitHub Release                │
    │    - publish ─────────────→  · Jurni-x.y.z-*.dmg/.zip        │
    │                               · latest-mac.yml ←────────── checks every 4h
    └─ done                                                        │
                                                                   ├─ downloads in background
                                                                   ├─ verifies signature
                                                                   └─ prompts "restart to install"
```

- **Updater module**: `electron/updater.js` — subscribed via
  `initAutoUpdater({ log, sendToMain })` in `app.whenReady()`. First check 8s
  after launch, then every 4h.
- **IPC contract**: main emits `update-status` events (`checking | downloading
  | ready | current | error`) to the renderer. Renderer mounts
  `<UpdateBanner>` globally; renderer calls `update-install` to restart+apply.
- **Signing**: hardened runtime + entitlements in
  `electron/assets/entitlements.mac.plist`.
- **Publish target**: GitHub Releases (configured in `package.json → build.publish`).
- **Secrets**: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
  `GH_TOKEN` — see `.env.example` and `RELEASE.md`. Never committed.
- **Dev mode**: `app.isPackaged === false` short-circuits the updater to a
  no-op.

See `RELEASE.md` for the full one-time setup and per-release checklist.

## Notes for Alpha

- Browser connectors are intentionally pragmatic and iterative.
- Claude/ChatGPT remain the most mature connector paths.
- Social connectors use a lightweight feed-capture path for speed-to-launch.
- Architecture is designed so providers can be improved without changing UI or DB contracts.