/**
 * LLM processing pipeline via OpenRouter.
 * ONE call per batch — extracts emotions, entities, decisions, patterns in a single pass.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'mistralai/mistral-small-2603';

function buildPrompt(moments, existingEntities, recentPatterns) {
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

  return `You are analyzing a batch of personal messages from someone's AI conversations. Your job is to extract psychological, emotional, and behavioral signals.
${entityContext}
${patternContext}

Here are ${moments.length} messages to analyze:

${messagesText}

Respond with ONLY valid JSON matching this exact structure:
{
  "emotions": [
    {
      "type": "string (one of: joy, excitement, hope, focus, calm, gratitude, pride, determination, relief, frustration, anxiety, burnout, overwhelm, confusion, anger, sadness, loneliness, disappointment)",
      "intensity": "number 0-1",
      "valence": "positive | negative | neutral",
      "trigger": "string - what caused this emotion",
      "message_index": "number - which message (1-indexed)"
    }
  ],
  "entities": [
    {
      "name": "string - person/project/place/topic name",
      "type": "person | project | place | topic",
      "sentiment": "number -1 to 1 (negative to positive)",
      "mention_count": "number"
    }
  ],
  "decisions": [
    {
      "topic": "string - what decision is being discussed",
      "status": "pending | made | revisited | abandoned"
    }
  ],
  "patterns": [
    {
      "type": "string (one of: indecision_loop, energy_cycle, trigger, habit, growth, regression, avoidance)",
      "description": "string - human-readable description of the pattern",
      "confidence": "number 0-1"
    }
  ],
  "notable": [
    {
      "message_index": "number",
      "reason": "string - why this is notable (breakthrough, crisis, milestone, etc.)"
    }
  ]
}

Rules:
- Only extract what's clearly present. Don't fabricate.
- For entities, use consistent naming (same person = same name).
- Connect new observations to known entities and patterns when relevant.
- Emotions should reflect the MESSAGE AUTHOR's state, not the AI's responses.
- Be specific in pattern descriptions — reference actual topics and behaviors.
- If a decision topic matches a previously revisited one, mark it as "revisited".`;
}

async function processBatch(moments, existingEntities, recentPatterns, apiKey, model) {
  if (!moments || moments.length === 0) return { emotions: [], entities: [], decisions: [], patterns: [], notable: [] };

  const prompt = buildPrompt(moments, existingEntities || [], recentPatterns || []);

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jurni.app',
      'X-Title': 'Jurni',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from LLM');
  }

  const analysis = parseAnalysis(content);

  // Link emotions to moment IDs
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

  // Link decisions to moment IDs
  if (analysis.decisions) {
    for (const decision of analysis.decisions) {
      decision.moment_ids = moments.map(m => m.id);
    }
  }

  // Add evidence to patterns
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

function parseAnalysis(content) {
  try {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse LLM response:', e.message);
    console.error('Raw content:', content.substring(0, 500));
    return { emotions: [], entities: [], decisions: [], patterns: [], notable: [] };
  }
}

module.exports = { processBatch, buildPrompt };
