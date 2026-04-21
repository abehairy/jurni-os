/**
 * Kind profiles — the pipeline's routing table.
 *
 * Every moment has a `kind` that declares what it IS. Each kind has a profile
 * that tells the pipeline how to handle it. No if/else, no provider checks —
 * just a lookup.
 *
 * Adding a new data source (calendar, photos, notes) means:
 *   1. add a row here
 *   2. tag moments with the matching `kind` at ingest time
 * The processor, categorizer, and scoring stages pick up the behavior for free.
 *
 * Profile fields:
 *   categorizeInto: 'thread' | 'moment'
 *     'thread' — moments sharing metadata.conversation_name get one LLM call
 *                that labels the whole group (topic / category / tone / summary).
 *                Only makes sense when the moments are genuinely one conversation.
 *     'moment' — each moment stands alone. Skips thread categorization entirely.
 *                Entities still get extracted per-moment.
 *
 *   selfMentionWeight: number
 *     Multiplier applied to mention_count when the user is the author of the
 *     moment. Self-authored content = higher signal about what matters to them.
 */
const KIND_PROFILES = {
  dialogue: {
    categorizeInto: 'thread',
    selfMentionWeight: 1,
  },
  post: {
    categorizeInto: 'moment',
    selfMentionWeight: 3,
  },
};

const DEFAULT_KIND = 'dialogue';

function getKindProfile(kind) {
  return KIND_PROFILES[kind] || KIND_PROFILES[DEFAULT_KIND];
}

function isValidKind(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_PROFILES, kind);
}

module.exports = {
  KIND_PROFILES,
  DEFAULT_KIND,
  getKindProfile,
  isValidKind,
};
