# Jurni — Vision Document

## One-liner

**Current (Vision A, shipping):** A mirror for the life you've been living in your chats. Jurni reads your AI conversations and shows you the landscape of what's actually mattered — week by week, topic by topic.

**Original (pre-pivot):** Your life has patterns you can't see. Jurni sees them.
**Pivot option:** Your life runs on 20 apps. Jurni runs on one.

---

## What's built (April 2026)

The **Life Landscape** is now the main dashboard. It replaces the single-number "Life Recovery Score" with a living treemap:

- Every AI conversation is categorized by topic (named subject like "Clinera", "Yara", "Career Shift") and domain (work / love / family / faith / money / body / mind / craft / peers / public / hearth / grief).
- Topics are drawn as tiles sized by frequency. Bigger tile = more of your attention that period.
- Each tile shows change-vs-previous period, a sparkline, and a short tone word ("open", "stuck", "alive", "waiting").
- A scrubber lets you slide week-by-week back through time. The landscape reshapes smoothly.
- Clicking a tile reveals the stories behind it — the specific conversations, the people mentioned, a tone reading.
- A narrated caption names the dominant topic, biggest riser, and biggest faller.

**The bet**: most people don't need a score. They need to see what they've been living in. The landscape is the mirror — no prescription, no gamification, just recognition.

---

## The Problem (shared)

People's lives are fragmented across dozens of tools — bank apps, calendars, fitness trackers, messaging apps, notes, spreadsheets. Nobody has a unified picture of how their life is actually going. The people who try to build one end up spending more time managing their systems than living their lives.

Meanwhile, millions of people are now having their deepest conversations with AI — about career decisions, relationships, finances, health goals. That data sits in chat logs nobody ever revisits.

---

# Vision A: The Analyzer (Original Jurni)

## What it does

Jurni ingests your AI conversation history (Claude, ChatGPT) and uses LLM analysis to extract emotions, behavioral patterns, decision loops, and relationship signals. It computes a daily "Life Recovery Score" (0-100) across five dimensions: Emotional, Mental, Relational, Routine, and Professional.

## How it works

1. Connect your Claude/ChatGPT account (browser connector or JSON import)
2. Jurni reads your conversations and runs batch LLM extraction
3. You get a Whoop-like score ring showing your Life Recovery Score
4. Timeline of moments, people mentioned, patterns detected
5. Score updates as you keep chatting with AI

## The pitch

"Whoop for your mind. You already track your body. Jurni tracks the rest — your decisions, emotions, and relationships — from conversations you're already having."

## Target user

Quantified-self enthusiasts who use AI chatbots daily for personal/life conversations.

## Revenue model

Premium tier with deeper analysis, longer history, more dimensions.

## Why it doesn't work

- **The score is ungrounded.** A Life Recovery Score derived only from chat messages measures how much you talk to AI about your problems, not how your life is going. Someone venting daily scores "worse" than someone who's actually struggling but doesn't use chatbots.
- **Insight without action.** "You mentioned 15 people" and "you have 3 open decisions" are observations, not tools. The user's reaction is "so what?" There's no way to act on anything.
- **One data source = narrow lens.** AI chat is a slice of a slice. It captures what you say to a chatbot, not what you do, earn, spend, or experience.
- **No retention hook.** Day 1 is magical (the discovery animation). Day 2, what's new? The score moves slowly. No daily utility, no reason to come back.
- **Small TAM.** People who (a) use AI chatbots daily, (b) for personal/life topics, (c) and want to analyze those conversations is a tiny intersection.

---

# Vision B: The Life OS (Pivot)

## What it does

Jurni is a local-first personal operating system that helps you manage your life across four domains: Finances, Time, Health, and Relationships. It pulls data from the tools you already use, gives you a unified dashboard, and surfaces what needs your attention.

## How it works

1. Open Jurni. See your life at a glance — four domain cards showing what matters today.
2. Connect integrations: bank account, Google Calendar, Apple Health, AI chat history.
3. Each domain shows real metrics: budget status, today's schedule, activity streaks, who you haven't talked to.
4. Quick capture anything from the dashboard. Log an expense, add a task, note a conversation.
5. Jurni scores each domain's health (0-100) based on real data, not sentiment.
6. Later: input via Telegram, iMessage, email, voice call — capture life data from wherever you are.

## What you see when you open the app

```
Good morning, Ahmed.                          Sat, Apr 18

 FINANCES                    TIME
 $2,340 spent this month     3 meetings today
 68% of budget used          12 tasks open
 ▓▓▓▓▓▓░░ on track          Next: Dentist @ 2pm

 HEALTH                      RELATIONSHIPS
 6,200 steps today           Sarah — 3 days ago
 7.2h sleep (avg)            Mom — 12 days ago ⚠
 3-day exercise streak       2 birthdays this week

 ─────────────────────────────────────────────
 Recent
 · $45 groceries (auto from bank)
 · Task done: "Submit report"
 · 30min run logged
 · Note: "Call mom about weekend plans"
```

## The pitch

"Your life runs on 20 apps. Your bank doesn't know your calendar. Your calendar doesn't know your health. Your health app doesn't know your relationships. Jurni connects them all into one dashboard that tells you how your life is actually going — and helps you manage it."

## Target user

**Primary:** Busy professionals (25-45) who feel overwhelmed managing life across too many apps and want one calm place to see everything.

**Secondary:** Quantified-self people who already track things but want unification.

**Tertiary:** Anyone who's tried to build a "life system" in Notion/spreadsheets and burned out maintaining it.

## Why this works

- **Daily utility.** You open Jurni every morning because it shows you what matters today — across every domain, not just one.
- **Grounded scores.** Health score based on actual steps and sleep. Finance score based on real spending vs budget. Not vibes from chat logs.
- **Action, not analysis.** "Mom — 12 days ago" with a tap to call. "$2,340 spent, 68% of budget" with a tap to see where. Every metric leads to an action.
- **Large TAM.** Everyone manages finances, time, health, and relationships. The market is "adults with smartphones" not "AI chatbot power users."
- **Retention is built in.** Life data updates daily. New transactions, new events, new metrics. There's always something fresh.
- **AI chat becomes a superpower, not the product.** The existing chat ingestion pipeline becomes one adapter among many — it extracts tasks, financial mentions, relationship notes, and health goals from conversations and routes them to the right domain. It's the secret sauce, not the whole meal.
- **Local-first = trust.** All your life data on your machine. No cloud. This is a real differentiator for sensitive financial and health data.

## Revenue model

- **Free:** Manual entry + 1 integration + basic dashboard
- **Pro ($9/mo):** Unlimited integrations + AI extraction from chats + smart suggestions + domain health scores
- **Family ($19/mo):** Shared household dashboard (shared finances, shared calendar, family contacts)

## Competitive landscape

| Product | What it does | Why Jurni wins |
|---------|-------------|----------------|
| Notion | Build-your-own everything | Too much setup. Jurni is opinionated and ready. |
| Mint/Copilot | Finance only | Single domain. Jurni sees your whole life. |
| Apple Health | Health only | Single domain. Can't see your budget next to your sleep. |
| Whoop | Fitness score | Body only. Jurni scores your entire life. |
| OpenClaw | AI assistant orchestration | Developer-first, CLI-based. Jurni is consumer-grade, visual, beautiful. |
| Day One | Journaling | Passive reflection. Jurni is active management. |

## The moat

1. **Cross-domain intelligence.** No other app sees your finances AND calendar AND health AND relationships together. This enables insights nobody else can generate: "You spend more on food delivery in weeks where you have 5+ meetings" or "You exercise less in months where you're over budget."
2. **Input channel network effects.** The more ways you can capture data (app, Telegram, voice, email), the more complete the picture, the more valuable the dashboard.
3. **Local-first trust.** Competitors need your data on their servers. Jurni doesn't. For finances and health, this matters enormously.

---

## Migration Path (A to B)

What we keep from Vision A:
- Electron + React + SQLite local-first stack
- AI chat ingestion pipeline (now one adapter among many)
- LLM processing via OpenRouter (now domain-aware extraction, not emotion mining)
- The concept of scoring (now per-domain, grounded in real data)
- Design system (cream/terracotta palette, typography)
- Menu bar tray presence

What we replace:
- "Moments" become "Items" (universal, domain-tagged)
- Emotion/pattern tables become goals/people/recurring tables
- Single score ring becomes four domain cards
- Timeline becomes activity feed
- People screen becomes Relationships domain
- Patterns screen becomes cross-domain insights (later)
- Onboarding pivots from "connect your chatbot" to "connect your life"

---

## V1 Scope (8 weeks)

**Weeks 1-2:** New database schema, adapter architecture, IPC layer
**Weeks 3-4:** Dashboard UI, domain cards, activity feed, quick capture
**Weeks 5-6:** Domain detail views (Finance, Time, Health, Relationships)
**Weeks 7-8:** First real integrations (Google Calendar, Apple Health export, CSV bank import), domain health scores

**Post-V1:** Chat extractor adapter, Telegram input channel, smart suggestions, cross-domain insights, mobile companion
