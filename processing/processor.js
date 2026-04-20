/**
 * LLM processing pipeline via OpenRouter.
 *
 * Two separate passes, each with its own model:
 *
 *   1. processBatch()       — per-message. Extracts emotions, entities,
 *                             decisions, patterns. Runs cheap model.
 *
 *   2. categorizeThread()   — per-conversation-thread. Extracts ONE
 *                             {topic, category, tone, summary} for the
 *                             whole thread. Runs a quality model (Gemini
 *                             Flash or Claude Sonnet) because entity
 *                             resolution and naming are the core UX.
 *
 * The thread pass is what makes the Life Landscape accurate.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Default models. Overridable via config keys `analysis_model` + `landscape_model`.
const DEFAULT_ANALYSIS_MODEL = 'mistralai/mistral-small-2603';
const DEFAULT_LANDSCAPE_MODEL = 'google/gemini-2.5-flash';

const CATEGORIES = [
  'work', 'money', 'love', 'family', 'child', 'peers', 'faith',
  'body', 'mind', 'craft', 'public', 'hearth', 'grief', 'other',
];

// ---------- Per-message pass (emotions/entities/decisions/patterns) ----------

/**
 * Render the user-identity block that gets injected into every prompt.
 * Without this, the LLM has no way to know the narrator's own name, so it
 * extracts them as a "person" entity and categorizes threads about them
 * as "peers". This block is short on purpose — it's meant to be ignored
 * by the model unless a user-name token appears in the text.
 */
function buildIdentityBlock(identity) {
  if (!identity || !identity.name) return '';
  const aliasLine = identity.aliases && identity.aliases.length > 1
    ? ` (also referred to as ${identity.aliases.filter(a => a !== identity.name).slice(0, 5).join(', ')})`
    : '';
  return `\n━━━ WHO THE USER IS ━━━\nThese messages were WRITTEN BY ${identity.name}${aliasLine}. They are the narrator of their own life, not a subject within it.\n  · NEVER extract them as a person entity.\n  · NEVER use their name as a topic.\n  · NEVER categorize a thread as "peers" just because their name appears — that only means they're present, which they always are.\n  · In summaries, refer to them as "you", never by name.\n━━━━━━━━━━━━━━━━━━━━━━\n`;
}

function buildAnalysisPrompt(moments, existingEntities, recentPatterns, identity) {
  const identityBlock = buildIdentityBlock(identity);
  const entityContext = existingEntities.length > 0
    ? `\nKnown entities from previous analysis:\n${existingEntities.slice(0, 30).map(e =>
        `- "${e.name}" (${e.type}, mentioned ${e.mention_count}x, sentiment trend: ${
          e.sentiment_trajectory?.length > 0
            ? e.sentiment_trajectory.slice(-3).map(s => s.sentiment).join(' → ')
            : 'unknown'
        })`
      ).join('\n')}`
    : '';

  const patternContext = recentPatterns.length > 0
    ? `\nPreviously detected patterns:\n${recentPatterns.slice(0, 10).map(p =>
        `- [${p.type}] ${p.description} (confidence: ${p.confidence})`
      ).join('\n')}`
    : '';

  const messagesText = moments.map((m, i) =>
    `[${i + 1}] (${m.timestamp}) ${m.raw_content.substring(0, 500)}`
  ).join('\n\n');

  return `You are analyzing personal messages from someone's AI conversations. Extract psychological signals.
${identityBlock}${entityContext}
${patternContext}

Here are ${moments.length} messages to analyze:

${messagesText}

Respond with ONLY valid JSON:
{
  "emotions": [
    { "type": "joy|excitement|hope|focus|calm|gratitude|pride|determination|relief|frustration|anxiety|burnout|overwhelm|confusion|anger|sadness|loneliness|disappointment", "intensity": 0-1, "valence": "positive|negative|neutral", "trigger": "string", "message_index": "number 1-indexed" }
  ],
  "entities": [
    { "name": "string", "type": "person|project|place|topic", "sentiment": "-1 to 1", "mention_count": "number" }
  ],
  "decisions": [
    { "topic": "string", "status": "pending|made|revisited|abandoned" }
  ],
  "patterns": [
    { "type": "indecision_loop|energy_cycle|trigger|habit|growth|regression|avoidance", "description": "string", "confidence": "0-1" }
  ]
}

Rules:
- Only extract what's clearly present. Don't fabricate.
- For entities, use consistent naming.
- Emotions reflect the MESSAGE AUTHOR's state, not the AI's responses.
- Be specific in pattern descriptions.`;
}

async function processBatch(moments, existingEntities, recentPatterns, apiKey, model, identity) {
  if (!moments || moments.length === 0) {
    return { emotions: [], entities: [], decisions: [], patterns: [] };
  }

  const prompt = buildAnalysisPrompt(moments, existingEntities || [], recentPatterns || [], identity);
  const analysis = await callOpenRouter({
    prompt,
    apiKey,
    model: model || DEFAULT_ANALYSIS_MODEL,
      temperature: 0.3,
    maxTokens: 3000,
  });

  if (analysis.emotions) {
    for (const emotion of analysis.emotions) {
      const idx = (emotion.message_index || 1) - 1;
      if (moments[idx]) {
        emotion.moment_id = moments[idx].id;
        emotion.timestamp = moments[idx].timestamp;
      }
      delete emotion.message_index;
    }
  }

  if (analysis.decisions) {
    for (const decision of analysis.decisions) {
      decision.moment_ids = moments.map(m => m.id);
    }
  }

  if (analysis.patterns) {
    for (const pattern of analysis.patterns) {
      pattern.evidence = moments.slice(0, 5).map(m => ({
        moment_id: m.id,
        timestamp: m.timestamp,
        excerpt: m.raw_content.substring(0, 100),
      }));
    }
  }

  return analysis;
}

// ---------- Thread-level categorization (the Life Landscape pass) ----------

/**
 * Sample messages from a thread for the categorization prompt.
 * We take the first N messages (establish context) and the last M messages
 * (current state). Long threads can be 500+ messages — we never want to
 * include all of them. This keeps the prompt bounded regardless of size.
 */
function sampleThread(messages, firstN = 8, lastM = 4, charCap = 400) {
  if (messages.length <= firstN + lastM) {
    return messages.map(m => ({ ...m, excerpt: m.raw_content.substring(0, charCap) }));
  }
  const head = messages.slice(0, firstN);
  const tail = messages.slice(-lastM);
  return [
    ...head.map(m => ({ ...m, excerpt: m.raw_content.substring(0, charCap) })),
    { separator: true, count: messages.length - firstN - lastM },
    ...tail.map(m => ({ ...m, excerpt: m.raw_content.substring(0, charCap) })),
  ];
}

function buildThreadPrompt(thread, knownTopics = [], identity = null) {
  const identityBlock = buildIdentityBlock(identity);
  const topicContext = knownTopics.length > 0
    ? `\nTOPICS ALREADY IN THIS PERSON'S LANDSCAPE (reuse the EXACT name, casing and all, when this thread is about the same subject — this is how the landscape stays coherent over time):\n${
        knownTopics.slice(0, 40).map(t => `  · ${t.topic}   [${t.category}]`).join('\n')}`
    : '';

  const samples = sampleThread(thread.messages);
  const body = samples.map(s => {
    if (s.separator) return `\n  … [${s.count} messages between] …\n`;
    const time = new Date(s.timestamp).toISOString().slice(0, 10);
    return `  (${time}) ${s.excerpt}`;
  }).join('\n');

  return `You are distilling one conversation from a person's AI chat archive so they can see the shape of their own life by looking at the patterns in what they've been talking about.

This is the core of the product. Quality here is everything. Generic outputs make the whole system useless.
${identityBlock}
THREAD TITLE: "${thread.title}"
MESSAGES IN THREAD: ${thread.messages.length}
${topicContext}

CONVERSATION SAMPLE (first messages, then last messages, in chronological order):
${body}

Return ONLY this JSON, nothing else:

{
  "topic": "...",
  "category": "...",
  "tone": "...",
  "summary": "..."
}

── HOW TO WRITE EACH FIELD ─────────────────────────────────

TOPIC — the single named subject this thread is really about.

  Must be a proper noun or a short named concept. Strip modifier words
  ("Details", "Discussion", "Options", "Analysis", "Update", "Strategy").

  GOOD:  "Clinera", "Jurni", "Yara", "FMH Project", "Career Pivot",
         "US Embassy Cairo", "Rare Disease Project"
  BAD:   "Jurni Details"  →  "Jurni"
         "Contract Options"  →  the company or counterparty name
         "Healthcare Marketplace Discussion"  →  "Healthcare Marketplace"
         "Work", "Business", "Conversation", "General", "Meeting" — NEVER

  If a topic in the landscape list above matches, use it VERBATIM.
  If the thread is trivial (coding help, debugging, one-off task, no
  personal meaning), return null for topic — it won't appear on the map.

CATEGORY — which life domain this topic lives in. One of:
  ${CATEGORIES.join(', ')}

  'work' is for the person's ventures, clients, deals, projects.
  'craft' is for writing, making, creative work for its own sake.
  'mind' is for psychological/philosophical threads about self.
  'public' is for news, geopolitics, ideas bigger than the person.
  'peers' is for conversations ABOUT a specific person (not WITH them).
  'other' ONLY if nothing else fits. Don't default to it.

TONE — one word that captures how this thread FEELS, not what it's about.

  Pick from this vocabulary and use the FULL range — don't default to
  "exploratory" for everything. If the conversation is settled, say so.
  If it's going in circles, say stuck. If it's a live push, say alive.

    alive       charged, moving, kinetic
    warm        affectionate, close
    open        curious, exploring, early
    steady      stable, on track, no drama
    clear       decided, direction found
    peak        high point, breakthrough
    resolved    concluded, closed loop

    waiting     pending external response or decision
    quiet       low activity, background hum
    fading      losing energy, not returning

    tense       friction, disagreement
    strained    relational cost, keeping up appearances
    stuck       going in circles, loop, indecision
    concerning  worry, threat, negative drift

SUMMARY — one sentence, max 110 characters.

  This is THE hardest and most important line. It is what will appear on
  the map. It must feel like the person's life reflected back at them,
  not a transcript review.

  Rules (strict):
    • Second person, present tense. Address the reader as "you" or just
      describe the state without a subject.
    • Never use "the user", "user", "they", or any third-person label.
    • Never describe the conversation as an object — not "this thread",
      "this discussion", "the conversation explores…". Describe the LIFE
      MOMENT the conversation captures.
    • Be specific. Name the tension, the direction, or what's at stake.
    • Under 110 characters. Terse > flowery.

  GOOD examples:
    "Still circling whether Jurni is a product or a thesis."
    "Yara keeps coming back — warmth underneath the logistics."
    "Pushing AZ on terms you haven't decided you want."
    "Burnout signs louder than last month."
    "Clinera's pitch keeps evolving, core claim still blurry."
    "Looking for a reason to say no to the marketplace idea."
    "The embassy appointment is close, tension visible."

  BAD examples (never write like this):
    "The user discusses their business."                ← third person
    "User requests checking prior information."         ← clinical
    "This conversation explores the viability of…"      ← book report
    "Discussion of contract options and negotiations."  ← generic
    "A thread about work and related topics."           ← useless

  If the thread is trivial (code help, bug fix, quick lookup), summary
  should be null rather than inflated.`;
}

/**
 * Categorize a single conversation thread.
 *
 * @param {Object} thread
 * @param {string} thread.title            conversation_name from metadata
 * @param {Array}  thread.messages         moments in the thread (ordered by timestamp)
 * @param {Array}  knownTopics             [{topic, category, count}] for reuse
 * @param {string} apiKey
 * @param {string} [model]                 defaults to Gemini 2.5 Flash
 * @returns {Promise<{topic, category, tone, summary}>}
 */
async function categorizeThread(thread, knownTopics, apiKey, model, identity) {
  if (!thread || !thread.messages || thread.messages.length === 0) {
    return { topic: null, category: 'other', tone: null, summary: null };
  }

  const prompt = buildThreadPrompt(thread, knownTopics || [], identity);
  const result = await callOpenRouter({
    prompt,
    apiKey,
    model: model || DEFAULT_LANDSCAPE_MODEL,
    temperature: 0.2,
    maxTokens: 500,
  });

  // Normalize: reject placeholder topics, force category into allowed set
  let topic = sanitizeTopic(result.topic);
  // Last-line defense: if the model still returned the user's name as the
  // topic, wipe it — the thread is about the user, not a topic THEY own.
  if (topic && identity?.aliases?.some(a => a.toLowerCase() === topic.toLowerCase())) {
    topic = null;
  }
  // Ditto: "peers" was chosen because the model saw the user's name mentioned.
  let category = CATEGORIES.includes(result.category) ? result.category : 'other';
  if (category === 'peers' && !topic) category = 'mind';

  return {
    topic,
    category,
    tone: typeof result.tone === 'string' ? result.tone.toLowerCase().trim().split(/\s+/)[0] : null,
    summary: typeof result.summary === 'string' ? result.summary.trim().substring(0, 200) : null,
  };
}

const BAD_TOPICS = new Set([
  'unclear', 'unknown', 'other', 'general', 'discussion', 'conversation',
  'chat', 'message', 'thread', 'topic', 'subject', 'various', 'misc',
  'miscellaneous', 'none', 'n/a', 'null', 'untitled', 'work', 'business',
  'meeting', 'life',
]);

// Filler suffix words the LLM sometimes bolts onto a topic name.
// "Jurni Details" → "Jurni", "Healthcare Marketplace Discussion" →
// "Healthcare Marketplace". Only stripped when they're the TRAILING word
// so we don't mangle real names that happen to contain these tokens.
const TRAILING_FILLERS = /\s+(details?|discussions?|analys(i|e)s|options?|updates?|conversations?|review|summary|notes?|thoughts?|plan)$/i;

function sanitizeTopic(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim().replace(/^["']|["']$/g, '');
  // Strip filler suffix iteratively in case of "Jurni Details Discussion"
  for (let i = 0; i < 3; i++) {
    const next = cleaned.replace(TRAILING_FILLERS, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (BAD_TOPICS.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

// ---------- Per-tile briefing (the "card is informative" pass) ----------

/**
 * Category-specific extra fields we ask the LLM to emit (if data supports it).
 * Kept tight so the prompt stays small; LLM omits fields when data is thin.
 */
function briefingCategoryGuidance(category) {
  const figureFields = `,
  "key_figures": [ { "label": "Raise", "value": "$500k", "context": "pre-seed" } ]`;
  const workFields = `,
  "next_move": "one short line",
  "blockers": [ "short phrase" ]`;
  const peopleFields = `,
  "last_touchpoint": { "date": "YYYY-MM-DD", "context": "short" },
  "temperature": "warm | strained | distant"`;
  const map = {
    money: {
      fields: figureFields,
      notes: `For MONEY: extract any concrete numbers — amounts ($, €, £, EGP), percentages, runway months, MRR/ARR/burn, investor counts, deal sizes. Each as {label, value, context?}. Up to 4. Omit if stories have no numbers.`,
    },
    work: { fields: workFields, notes: `For WORK: next_move = the obvious next action if one is visible. blockers = what's stuck or waiting (up to 3 short phrases).` },
    craft: { fields: workFields, notes: `For CRAFT: next_move = obvious next step in the work. blockers = what's preventing shipping.` },
    body: {
      fields: `,
  "metrics": [ { "label": "Workouts", "value": "3 this week", "trend": "rising" } ]`,
      notes: `For BODY: extract frequencies, streaks, health metrics. Up to 4. Omit if no concrete counts.`,
    },
    mind: {
      fields: `,
  "open_questions": [ "short question" ],
  "themes": [ "short phrase" ]`,
      notes: `For MIND: open_questions are recurring unresolved questions (phrased as questions). themes are recurring motifs. Up to 3 of each.`,
    },
    peers: { fields: peopleFields, notes: `For PEERS: last_touchpoint = most recent concrete interaction visible in stories. temperature = overall relational feel. Don't fabricate.` },
    family: { fields: peopleFields, notes: `For FAMILY: same as peers — last_touchpoint + temperature if visible.` },
    love: { fields: peopleFields, notes: `For LOVE: last_touchpoint + temperature. Be careful, don't invent drama.` },
    child: { fields: peopleFields, notes: `For CHILD: last_touchpoint + temperature if visible.` },
    hearth: {
      fields: `,
  "last_touchpoint": { "date": "YYYY-MM-DD", "context": "short" }`,
      notes: `For HEARTH (home/domestic): last concrete event or task if visible.`,
    },
    faith: { fields: `,\n  "themes": [ "short phrase" ]`, notes: `For FAITH: recurring themes or motifs. Only if clearly present.` },
    public: { fields: `,\n  "themes": [ "short phrase" ]`, notes: `For PUBLIC: the topics/events dominating attention.` },
    grief: { fields: `,\n  "themes": [ "short phrase" ]`, notes: `For GRIEF: themes, with care. Never clinical.` },
  };
  return map[category] || { fields: '', notes: '' };
}

function buildBriefingPrompt(tile, stories, people, identity) {
  const identityBlock = buildIdentityBlock(identity);

  const storyLines = (stories || []).slice(0, 8).map(s => {
    const date = s.when ? new Date(s.when).toISOString().slice(0, 10) : '?';
    const tone = s.tone ? ` [${s.tone}]` : '';
    const msgCount = s.messageCount ? ` · ${s.messageCount}msg` : '';
    const title = s.what || 'Thread';
    const ex = s.excerpt ? `\n      ${s.excerpt}` : '';
    return `  (${date})${tone}${msgCount} "${title}"${ex}`;
  }).join('\n');

  const peopleLines = (people && people.length > 0)
    ? people.slice(0, 8).map(p => `  · ${p.name} (${p.mentions || p.count || '?'}x)`).join('\n')
    : '  (none mentioned)';

  const pctLabel = tile.pctOfTotal != null ? `${Math.round(tile.pctOfTotal * 100)}% of period` : '';
  const changeLabel = tile.changePct != null
    ? `${tile.changePct > 0 ? '+' : ''}${Math.round(tile.changePct)}% vs prior`
    : '';
  const toneLabel = tile.tone ? `tone: ${tile.tone}` : '';
  const metaBits = [pctLabel, changeLabel, toneLabel].filter(Boolean).join(' · ');

  const guidance = briefingCategoryGuidance(tile.category);

  return `You are briefing someone on one slice of their own life, in their voice. Concise, specific, direct. No preamble, no hedging, no fourth wall.
${identityBlock}
━━━ THE TILE ━━━
Category: ${tile.category}
Subject: ${tile.label}
${metaBits}

━━━ STORIES (conversation threads inside this slice) ━━━
${storyLines || '  (no stories)'}

━━━ PEOPLE IN THESE STORIES ━━━
${peopleLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:

{
  "briefing": "2-4 sentences. Second person ('you'). Present tense. Specific. Name what's moving, what's stuck, what's at stake. Feels like a close friend reminding you where you are. Never 'the user', never 'this tile', never 'this conversation'.",
  "state": "one word from: alive, warm, open, steady, clear, peak, resolved, waiting, quiet, fading, tense, strained, stuck, concerning, heavy",
  "trajectory": "rising | steady | fading"${guidance.fields}
}

${guidance.notes}

STRICT RULES:
  · Only include fields supported by the stories. Do NOT invent numbers, dates, or people.
  · If an optional field doesn't apply or the data is thin, OMIT it entirely (don't set it to null).
  · Briefing is the priority. Everything else is optional color.
  · Briefing under 300 characters total.
  · Refer to the user as "you" only. Never by name, never "the user".`;
}

/**
 * Generate a contextual briefing for one tile on the Life Landscape.
 * One LLM call. Called on demand when a drawer is opened. Cached upstream.
 *
 * @param {Object}  args.tile       { label, category, tone, pctOfTotal, changePct }
 * @param {Array}   args.stories    from db.getTileDetail().stories
 * @param {Array}   args.people     from db.getTileDetail().people
 * @param {string}  args.apiKey
 * @param {string} [args.model]     defaults to landscape model
 * @param {Object}  args.identity
 * @returns {Promise<Object|null>}
 */
async function generateBriefing({ tile, stories, people, apiKey, model, identity }) {
  if (!stories || stories.length === 0) return null;
  const prompt = buildBriefingPrompt(tile, stories, people || [], identity);
  const result = await callOpenRouter({
    prompt,
    apiKey,
    model: model || DEFAULT_LANDSCAPE_MODEL,
    temperature: 0.25,
    maxTokens: 600,
  });
  if (!result || typeof result.briefing !== 'string' || result.briefing.length < 10) {
    return null;
  }
  if (result.briefing.length > 500) result.briefing = result.briefing.slice(0, 500);
  return result;
}

// ---------- Tile chat ----------
// Conversational Q&A scoped to a single tile. Unlike briefings this is open
// text: the user asks a question about their own data, the LLM answers using
// the tile's stories + people + briefing as context.
//
// We pass the conversation history so follow-up questions work. Context
// (stories/people/briefing) is injected as a system message — not repeated
// with every turn, keeping tokens in check even across long chats.
async function chatWithTile({ tile, stories = [], people = [], briefing, messages = [], apiKey, model, identity }) {
  const system = buildTileChatSystemPrompt(tile, stories, people, briefing, identity);
  const chatMessages = [
    { role: 'system', content: system },
    ...messages.slice(-20), // keep last 20 turns so prompts stay bounded
  ];
  const text = await callOpenRouterText({
    messages: chatMessages,
    apiKey,
    model: model || DEFAULT_LANDSCAPE_MODEL,
    temperature: 0.4,
    maxTokens: 700,
  });
  return (text || '').trim();
}

function buildTileChatSystemPrompt(tile, stories, people, briefing, identity) {
  const who = identity?.name || 'the user';
  const storyLines = stories.slice(0, 12).map((s, i) => {
    const date = (s.date || '').slice(0, 10);
    return `${i + 1}. [${date}${s.tone ? ' · ' + s.tone : ''}] ${s.summary || s.label || ''}`;
  }).join('\n');
  const peopleLines = (people || []).slice(0, 10).map(p => `- ${p.name}${p.count ? ` (${p.count})` : ''}`).join('\n');
  const briefingText = briefing?.briefing ? `\nBriefing: ${briefing.briefing}` : '';

  return [
    `You are Jurni, a calm, thoughtful companion helping ${who} understand a slice of their life.`,
    `The user is asking about the tile "${tile.label}" (category: ${tile.category || 'other'}${tile.tone ? ', tone: ' + tile.tone : ''}).`,
    ``,
    `Use ONLY the context below to answer. If a question can't be answered from this data, say so honestly.`,
    `Be concrete and specific — cite concrete moments, dates, and names from the stories when helpful.`,
    `Keep answers to 2–4 short paragraphs max. No bullet spam unless explicitly asked.`,
    `Avoid therapy-speak. Don't moralize. Reflect what's there.`,
    briefingText,
    ``,
    `## Recent stories in this tile (most recent first):`,
    storyLines || '(none)',
    peopleLines ? `\n## People co-mentioned:\n${peopleLines}` : '',
  ].filter(Boolean).join('\n');
}

// Plain-text OpenRouter call (no JSON mode). Used for tile chat.
async function callOpenRouterText({ messages, apiKey, model, temperature = 0.4, maxTokens = 700 }) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jurni.app',
      'X-Title': 'Jurni',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ---------- Shared OpenRouter call ----------

async function callOpenRouter({ prompt, apiKey, model, temperature = 0.3, maxTokens = 2000 }) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jurni.app',
      'X-Title': 'Jurni',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse LLM response:', e.message, content.substring(0, 300));
    return {};
  }
}

/**
 * Validate an OpenRouter API key by calling the dedicated /auth/key endpoint.
 * Returns { ok: true, data } on success, { ok: false, reason, status } on failure.
 *
 * Called from the Onboarding screen before the user moves past the API key
 * step so typos / revoked keys / no-credits keys surface immediately instead
 * of silently breaking the landscape later.
 */
async function validateOpenRouterKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, reason: 'Key is empty' };
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://jurni.app',
        'X-Title': 'Jurni',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'Key is invalid or revoked', status: res.status };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, reason: `OpenRouter returned ${res.status}`, status: res.status, detail: text.slice(0, 200) };
    }
    const json = await res.json().catch(() => null);
    // /auth/key returns { data: { label, usage, limit, is_free_tier, rate_limit, ... } }
    const data = json?.data || null;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: e.message || 'Network error reaching OpenRouter' };
  }
}

module.exports = {
  processBatch,
  categorizeThread,
  generateBriefing,
  chatWithTile,
  validateOpenRouterKey,
  CATEGORIES,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_LANDSCAPE_MODEL,
};
