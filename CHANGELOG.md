# Changelog

All notable changes to Jurni will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.1] — signed + notarized alpha

### Added
- First signed + notarized release on the public `jurni-os` repo.
- Auto-update via `electron-updater` with signed + notarized macOS builds
  for both Apple Silicon (arm64) and Intel (x64). See
  [RELEASE.md](./RELEASE.md).
- `UpdateBanner` component — in-app toast for "update ready, restart to install".
- `kind` column on moments (`dialogue` | `post`) — drives pipeline routing.
- `processing/kinds.js` — single-source-of-truth lookup table (KIND_PROFILES)
  that replaces per-provider branching.
- `electron/connectors/registry.js` — canonical connector metadata, extended
  with `kind` per source.
- Public-facing documentation: `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue and PR templates.
- MIT `LICENSE`.
- Landing page at `docs/index.html` for GitHub Pages.

### Changed
- Thread categorizer now only processes `kind='dialogue'` moments. Social
  posts no longer get force-bucketed into one mega-"thread" with a single
  made-up topic — a root cause of domain-donut collapse and empty briefings.
- Entity `mention_count` from self-authored moments is weighted 3×, so
  people you talk about rank above people who appear in your feed.
- `handleCapturedMessage` derives `kind` from the connector registry
  instead of branching on provider.
- `autoProcessBatch` splits queues by `(kind, author)` before calling the
  LLM, so entity weights can be applied correctly.

### Fixed
- Social posts (X, LinkedIn, Facebook, Instagram) no longer corrupt the
  Life Landscape with bogus "X Feed" thread labels.
- Stale thread labels on previously-ingested social posts wiped on migration.

## [0.1.0] — initial alpha

First private build. Core loop working: browser connectors for Claude +
ChatGPT, per-moment entity extraction, thread categorization, Life Landscape
treemap UI.
