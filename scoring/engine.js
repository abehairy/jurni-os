/**
 * Life Recovery Score Engine — pure math, no LLM.
 *
 * Score: 0–100 from five dimensions (20 pts each):
 *   Emotional, Mental, Relational, Routine, Professional
 */

const POSITIVE_EMOTIONS = new Set([
  'joy', 'excitement', 'hope', 'focus', 'calm',
  'gratitude', 'pride', 'determination', 'relief',
]);
const NEGATIVE_EMOTIONS = new Set([
  'frustration', 'anxiety', 'burnout', 'overwhelm', 'confusion',
  'anger', 'sadness', 'loneliness', 'disappointment',
]);

function computeScores(db) {
  const emotional = computeEmotional(db);
  const mental = computeMental(db);
  const relational = computeRelational(db);
  const routine = computeRoutine(db);
  const professional = computeProfessional(db);
  const overall = emotional + mental + relational + routine + professional;

  return { overall, emotional, mental, relational, routine, professional };
}

function computeEmotional(db) {
  const emotions = db.getEmotions(7);
  if (emotions.length === 0) return 10; // neutral baseline

  let positive = 0;
  let negative = 0;

  for (const e of emotions) {
    const intensity = e.intensity || 0.5;
    if (POSITIVE_EMOTIONS.has(e.type) || e.valence === 'positive') {
      positive += intensity;
    } else if (NEGATIVE_EMOTIONS.has(e.type) || e.valence === 'negative') {
      negative += intensity;
    }
  }

  const total = positive + negative;
  if (total === 0) return 10;

  const ratio = positive / total;
  return Math.round(ratio * 20);
}

function computeMental(db) {
  const openDecisions = db.getOpenDecisions();

  let penalty = 0;
  for (const d of openDecisions) {
    // 2 points per open decision, extra for revisited ones
    if (d.status === 'revisited' || d.revisit_count >= 3) {
      penalty += 3;
    } else {
      penalty += 2;
    }
  }

  return Math.max(0, 20 - Math.min(penalty, 20));
}

function computeRelational(db) {
  const people = db.getEntities('person');
  if (people.length === 0) return 10; // neutral baseline

  const recentPeople = people.filter(p => {
    if (!p.last_seen) return false;
    const daysSince = (Date.now() - new Date(p.last_seen).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 7;
  });

  // Score based on social breadth (0-10 pts) and sentiment (0-10 pts)
  const breadthScore = Math.min(recentPeople.length * 2, 10);

  let sentimentSum = 0;
  let sentimentCount = 0;
  for (const person of recentPeople) {
    const traj = person.sentiment_trajectory || [];
    if (traj.length > 0) {
      const latest = traj[traj.length - 1];
      sentimentSum += latest.sentiment;
      sentimentCount++;
    }
  }

  const avgSentiment = sentimentCount > 0 ? sentimentSum / sentimentCount : 0;
  // Map sentiment from [-1, 1] to [0, 10]
  const sentimentScore = Math.round((avgSentiment + 1) * 5);

  return Math.min(breadthScore + sentimentScore, 20);
}

function computeRoutine(db) {
  // Detect consistency in calendar events and conversation timing patterns
  const moments = db.getMoments({ limit: 200 });

  if (moments.length < 10) return 10; // not enough data

  // Check for regular daily activity patterns
  const hourCounts = new Array(24).fill(0);
  const dayCounts = new Array(7).fill(0);

  for (const m of moments) {
    const d = new Date(m.timestamp);
    hourCounts[d.getHours()]++;
    dayCounts[d.getDay()]++;
  }

  // Consistency = how evenly distributed across active hours
  const activeHours = hourCounts.filter(c => c > 0).length;
  const activeDays = dayCounts.filter(c => c > 0).length;

  // Having regular patterns across multiple days is good
  const dayConsistency = Math.min(activeDays / 5, 1); // 5+ active days = full marks
  const hourRegularity = activeHours >= 4 && activeHours <= 16 ? 1 : 0.5; // not all-nighters

  return Math.round((dayConsistency * 12 + hourRegularity * 8));
}

function computeProfessional(db) {
  const decisions = db.db.prepare('SELECT * FROM decisions').all();
  if (decisions.length === 0) return 10;

  const made = decisions.filter(d => d.status === 'made').length;
  const pending = decisions.filter(d => d.status === 'pending').length;
  const revisited = decisions.filter(d => d.status === 'revisited').length;
  const total = decisions.length;

  // Progress = made decisions / total decisions
  const progressRatio = total > 0 ? made / total : 0.5;

  // Stagnation penalty from revisits
  const stagnationPenalty = Math.min(revisited * 2, 10);

  const baseScore = Math.round(progressRatio * 20);
  return Math.max(0, Math.min(baseScore - stagnationPenalty, 20));
}

function getScoreColor(score) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

function getScoreSummary(score) {
  if (score >= 80) return "You're thriving. Keep doing what you're doing.";
  if (score >= 70) return "You're in good shape. A few things to watch.";
  if (score >= 55) return "Stress is building. Pay attention to the signals.";
  if (score >= 40) return "Things are getting heavy. Take care of yourself.";
  if (score >= 25) return "You need a reset. Reach out to someone you trust.";
  return "Take care of yourself today. Seriously.";
}

module.exports = { computeScores, getScoreColor, getScoreSummary };
