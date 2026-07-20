import { DEFAULT_PROFILE } from "../shared/default-profile";
import { HabitSchema } from "../shared/habit";
import { ProfileSchema, type Profile } from "../shared/profile";
import { scoreHabit, type ScorableHabit, type ScoreBreakdown, type ScoringContext } from "../shared/scoring";
import { bucketFor, localDateFor } from "../shared/time-of-day";

/** How long a habit stays "recently suggested" and so loses its novelty credit. */
const NOVELTY_WINDOW_DAYS = 14;

const SUGGESTION_COUNT = 3;

export interface Suggestion {
  habit: ScorableHabit;
  score: number;
  breakdown: ScoreBreakdown;
}

interface HabitRow {
  id: string;
  title: string;
  category: string;
  tags: string;
  identity_statement: string;
  tiny_version: string;
  standard_version: string;
  ambitious_version: string | null;
  cue_suggestion: string | null;
  time_of_day: string;
  duration_minutes: number;
  difficulty: number;
  frequency_default: string;
  stack_anchors: string;
  prerequisites: string | null;
}

/** D1 stores JSON-ish columns as TEXT; rebuild the validated shape the scorer expects. */
function toScorableHabit(row: HabitRow): ScorableHabit {
  const habit = HabitSchema.parse({
    title: row.title,
    category: row.category,
    tags: JSON.parse(row.tags),
    identity_statement: row.identity_statement,
    tiny_version: row.tiny_version,
    standard_version: row.standard_version,
    ambitious_version: row.ambitious_version ?? undefined,
    cue_suggestion: row.cue_suggestion ?? undefined,
    time_of_day: row.time_of_day,
    duration_minutes: row.duration_minutes,
    difficulty: row.difficulty,
    frequency_default: row.frequency_default,
    stack_anchors: JSON.parse(row.stack_anchors),
    prerequisites: row.prerequisites,
  });

  return { ...habit, id: row.id };
}

/** SQLite's `datetime()` text format, so shown_at comparisons stay lexicographic. */
function toSqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * A malformed or absent profile must never break the daily loop — the engine
 * reads whatever profile it is handed, and the default is a working one
 * (CLAUDE.md §5: "the app never breaks because a model had a bad day").
 */
async function loadProfile(db: D1Database, userId: string): Promise<Profile> {
  const row = await db
    .prepare("SELECT data FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ data: string }>();

  if (!row) return DEFAULT_PROFILE;

  try {
    return ProfileSchema.parse(JSON.parse(row.data));
  } catch {
    return DEFAULT_PROFILE;
  }
}

async function buildContext(
  db: D1Database,
  userId: string,
  now: Date,
  timezone: string,
): Promise<{ ctx: ScoringContext; adoptedHabitIds: Set<string> }> {
  const cutoff = new Date(now.getTime() - NOVELTY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Every query below is scoped by the session-resolved user_id — the
  // multi-tenancy rule (CLAUDE.md §12).
  const [adopted, recent, declined, streak] = await Promise.all([
    db
      .prepare(
        `SELECT uh.habit_id, h.category
           FROM user_habits uh
           JOIN habits h ON h.id = uh.habit_id
          WHERE uh.user_id = ? AND uh.archived_at IS NULL`,
      )
      .bind(userId)
      .all<{ habit_id: string; category: string }>(),
    db
      .prepare("SELECT DISTINCT habit_id FROM suggestion_log WHERE user_id = ? AND shown_at >= ?")
      .bind(userId, toSqlDatetime(cutoff))
      .all<{ habit_id: string }>(),
    db
      .prepare("SELECT DISTINCT habit_id FROM suggestion_log WHERE user_id = ? AND outcome = 'dismissed'")
      .bind(userId)
      .all<{ habit_id: string }>(),
    db
      .prepare(
        `SELECT COALESCE(MAX(s.current), 0) AS max_streak
           FROM streaks s
           JOIN user_habits uh ON uh.id = s.user_habit_id
          WHERE uh.user_id = ?`,
      )
      .bind(userId)
      .first<{ max_streak: number }>(),
  ]);

  const adoptedHabitIds = new Set<string>();
  const activeCountByCategory: Record<string, number> = {};

  for (const row of adopted.results) {
    adoptedHabitIds.add(row.habit_id);
    activeCountByCategory[row.category] = (activeCountByCategory[row.category] ?? 0) + 1;
  }

  return {
    adoptedHabitIds,
    ctx: {
      bucket: bucketFor(now, timezone),
      activeCountByCategory,
      recentlySuggestedHabitIds: new Set(recent.results.map((r) => r.habit_id)),
      declinedHabitIds: new Set(declined.results.map((r) => r.habit_id)),
      maxCurrentStreak: streak?.max_streak ?? 0,
    },
  };
}

/**
 * Suggestions already chosen for this user's local day, still awaiting a
 * decision. Returning these rather than rescoring is what makes "today's three"
 * mean something: the cards stay put across app opens, and `suggestion_log`
 * records one impression per suggestion instead of one per page load.
 *
 * Rows with an outcome are left out — a habit the user has adopted or
 * dismissed has been dealt with, and shouldn't reappear on the same day. The
 * remaining cards keep their original order, so acting on one card never moves
 * the others.
 */
async function replayTodaysSuggestions(
  db: D1Database,
  userId: string,
  localDate: string,
): Promise<Suggestion[] | null> {
  const { results } = await db
    .prepare(
      `SELECT h.*, sl.score AS logged_score, sl.score_breakdown AS logged_breakdown, sl.outcome
         FROM suggestion_log sl
         JOIN habits h ON h.id = sl.habit_id
        WHERE sl.user_id = ? AND sl.local_date = ?
        ORDER BY sl.score DESC, sl.habit_id ASC`,
    )
    .bind(userId, localDate)
    .all<HabitRow & { logged_score: number; logged_breakdown: string; outcome: string | null }>();

  // No rows at all means today hasn't been scored yet — the caller should score.
  if (results.length === 0) return null;

  return results
    .filter((row) => row.outcome === null)
    .map((row) => ({
      habit: toScorableHabit(row),
      score: row.logged_score,
      breakdown: JSON.parse(row.logged_breakdown) as ScoreBreakdown,
    }));
}

/**
 * Today's three suggestions, deterministically scored (CLAUDE.md §6). Scored
 * once per local day and replayed thereafter. Every suggestion is logged with
 * its breakdown — that log is the tuning data for Phase 3, and the reason a
 * surprising suggestion can always be explained after the fact.
 */
export async function getSuggestions(
  db: D1Database,
  userId: string,
  now: Date,
): Promise<Suggestion[]> {
  const user = await db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .bind(userId)
    .first<{ timezone: string }>();

  if (!user) return [];

  // The day boundary is the user's, not the server's (CLAUDE.md §7).
  const localDate = localDateFor(now, user.timezone);

  const alreadyChosen = await replayTodaysSuggestions(db, userId, localDate);
  if (alreadyChosen) return alreadyChosen;

  const [profile, { ctx, adoptedHabitIds }] = await Promise.all([
    loadProfile(db, userId),
    buildContext(db, userId, now, user.timezone),
  ]);

  const { results } = await db.prepare("SELECT * FROM habits").all<HabitRow>();

  const suggestions = results
    // adopted_exclusion is a hard filter, not a score term (design spec §1).
    .filter((row) => !adoptedHabitIds.has(row.id))
    .map((row) => {
      const habit = toScorableHabit(row);
      const { score, breakdown } = scoreHabit(habit, profile, ctx);
      return { habit, score, breakdown };
    })
    // Ties break on habit id ascending so equal scores never reorder between calls.
    .sort((a, b) => b.score - a.score || (a.habit.id < b.habit.id ? -1 : 1))
    .slice(0, SUGGESTION_COUNT);

  if (suggestions.length > 0) {
    const shownAt = toSqlDatetime(now);
    await db.batch(
      suggestions.map((suggestion) =>
        db
          .prepare(
            "INSERT INTO suggestion_log (id, user_id, habit_id, score, score_breakdown, shown_at, local_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            userId,
            suggestion.habit.id,
            suggestion.score,
            JSON.stringify(suggestion.breakdown),
            shownAt,
            localDate,
          ),
      ),
    );
  }

  return suggestions;
}
