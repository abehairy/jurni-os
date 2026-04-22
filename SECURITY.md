# Security Policy

## Supported versions

Jurni is in active alpha. We only support the **latest released version**.
Please update before reporting any issue — auto-update usually picks it up
within 4 hours of launch.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email `security@everestminds.com` with:

- A description of the issue
- Steps to reproduce (if possible, a proof-of-concept)
- The affected version (check the About screen or `package.json`)
- Your name / handle if you'd like credit in the release notes

We'll acknowledge within 48 hours and give a first assessment within 5
business days. Critical issues get a same-day patch release; others are
bundled into the next scheduled release.

## Scope

In scope:

- The Jurni desktop app (`electron/`, `channels/`, `processing/`,
  `scoring/`, `src/`)
- The auto-updater and release pipeline
- The browser-preload crawlers (anything that runs inside a BrowserWindow
  we control)

Out of scope:

- Vulnerabilities in upstream LLM providers (OpenRouter, Claude, etc.) —
  report those to the respective vendor
- Vulnerabilities in the websites Jurni scrapes (Claude, ChatGPT, X,
  LinkedIn, etc.) — those are the vendors' responsibility
- Social engineering of Jurni users or maintainers

## What Jurni already does

Because local-first is a first-class value:

- All user data lives in `~/.jurni/` on the user's Mac — nothing is
  transmitted to Everest Minds or any Jurni-controlled server
- LLM calls go direct to the user's chosen provider using the user's own
  API key (no Jurni-owned proxy)
- No telemetry, analytics, or crash reporting
- Code-signed + notarized builds via Apple's Developer ID program
- Auto-update verifies signatures before installing
- `~/.jurni/` is `chmod 700` and contains only the user's data

## Responsible disclosure

We'll credit reporters in the release notes unless they ask otherwise. If
the issue affects users' data, we'll also issue a clear in-app notice on
the next launch explaining what happened and what to do.
