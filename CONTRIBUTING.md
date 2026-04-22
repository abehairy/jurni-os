# Contributing to Jurni

Thanks for wanting to help. Jurni is small, opinionated, and built to be
extended — the architecture is designed so you can add a new data source or
fix a connector without touching the rest of the pipeline.

Read this once. Skim it again before your first PR.

## Ground rules

1. **Local-first is non-negotiable.** Jurni never phones home. No telemetry,
   no analytics, no crash reports. Outbound traffic is limited to (a) the
   user's LLM provider, and (b) GitHub for update checks. If your change
   needs network access anywhere else, open an issue first.

2. **Keep the pipeline clean.** We have one primitive (`kind`) that routes
   every moment through the processor. No `if (provider === 'x')` anywhere.
   If you're adding something that feels special-case, check
   `processing/kinds.js` and `electron/connectors/registry.js` — the answer
   is almost always there.

3. **Simplicity > cleverness.** We care more that the code is easy to
   understand in six months than that it's compact or elegant today. Small,
   boring changes are the best changes.

4. **Don't bloat.** If you find yourself adding a third "helper" module for
   the same concept, stop and refactor instead. "Patch on patch" is how
   apps die.

## Local development

Prereqs:
- macOS (Windows and Linux ports welcome — see open issues)
- Node 18+ (ideally via [fnm](https://github.com/Schniz/fnm) or nvm)
- An [OpenRouter](https://openrouter.ai) API key (or compatible) for LLM calls

Setup:

```bash
git clone https://github.com/abehairy/jurni-os.git
cd jurni
npm install
npm run dev
```

This runs Vite (renderer) and Electron (main) together with hot reload.

### Reset your local database

```bash
npm run reset
```

### Tail the main-process logs

```bash
npm run logs
```

## Architecture in one screen

```
electron/               ← main process (Node)
  main.js               ← app lifecycle, IPC handlers
  database.js           ← sqlite schema, queries
  updater.js            ← auto-update
  connectors/
    registry.js         ← ONE place that knows every data source
  preload.js            ← IPC surface exposed to renderer

channels/
  browser-preload.js    ← injected into connector BrowserWindows
                         (scrapes Claude, ChatGPT, X, LinkedIn, etc.)
  conversation.js       ← JSON import parser

processing/
  processor.js          ← LLM calls (extraction + thread labeling)
  kinds.js              ← pipeline routing table (KIND_PROFILES)

scoring/
  engine.js             ← dimensional + overall scores

src/                    ← renderer (React + Vite)
  App.jsx
  screens/
  components/
```

Full details in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Adding a new data source

The shortest possible path:

1. **Register it.** Add a row to `electron/connectors/registry.js`:
   ```js
   myservice: {
     id: 'myservice',
     title: 'MyService',
     url: 'https://myservice.com',
     kind: 'post',  // or 'dialogue'
     supportsSync: true,
     supportsHistoricalImport: false,
   }
   ```

2. **If it's a browser source**, add a crawler path in
   `channels/browser-preload.js` that pushes captured content via
   `conversation-message` IPC. Follow the X/LinkedIn pattern.

3. **If it's a new kind** (not dialogue or post), add a row to
   `processing/kinds.js` declaring how the processor should route it:
   ```js
   event: {
     categorizeInto: 'moment',  // or 'thread'
     selfMentionWeight: 1,
   }
   ```

4. **Add UI toggles** in `src/screens/Onboarding.jsx` and
   `src/screens/Settings.jsx`.

That's it. The processor, categorizer, scorer, and Landscape view pick up
the new source automatically.

## Code style

- **JavaScript**, no TypeScript (yet).
- **React function components** with hooks. No class components.
- **CSS variables** for theming — never hardcode colors. Use `var(--surface)`,
  `var(--text-primary)`, etc.
- **Animations** via [Framer Motion](https://www.framer.com/motion/).
- **2-space indent**, single quotes, trailing commas.
- **Comments explain *why*, not *what***. The code says what. Don't write
  `// set the count to zero` — that's not helpful. Write `// reset on window
  focus because the cache gets stale` — that's useful.

## Pull requests

1. **Open an issue first** for non-trivial changes. A 2-line description of
   what you're planning saves both of us time.

2. **One change per PR.** If your branch has "misc fixes" in the title, split it.

3. **Commit messages matter.** Format: `<area>: <imperative summary>`.
   Examples:
   - `connectors: harden LinkedIn feed selector`
   - `processor: skip self-entity purge for imported data`
   - `ui: fix landscape donut flicker on empty state`

4. **Test your change manually.** There's no test suite yet (contributions
   welcome). At minimum:
   - `npm run dev` → your feature works end-to-end
   - Onboarding still completes cleanly
   - No console errors

5. **Update docs.** If you changed architecture, update `ARCHITECTURE.md`.
   If you added a user-facing feature, update `README.md` and
   `CHANGELOG.md`.

## Reporting bugs

Use the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.md). Include:
- What you expected
- What happened instead
- Steps to reproduce
- Contents of `~/.jurni/crawler.log` (redact anything personal)
- macOS version + Jurni version

## Reporting security issues

Do **not** open a public issue. See [SECURITY.md](./SECURITY.md) — it points
to GitHub's private security advisories.

## Community

Be kind. We follow the [Contributor Covenant](./CODE_OF_CONDUCT.md).
