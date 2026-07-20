import { applyCheckin, type CheckinOutcome, type StreakState } from "../shared/streaks";
import { localDateFor } from "../shared/time-of-day";

/**
 * Adoption, check-off and undo. Every query is scoped by the session-resolved
 * `user_id` — a route can never be steered at another tenant's rows
 * (CLAUDE.md §12).
 */

/** CLAUDE.md §2.6: users hold a small number of active habits. User-adjustable later. */
export const ACTIVE_HABIT_CAP = 5;

export type AdoptResult =
  | { ok: true; userHabitId: string }
  | { ok: false; reason: "unknown_habit" | "habit_cap_reached" | "already_adopted" };

export async function adoptHabit(
  db: D1Database,
  userId: string,
  habitId: string,
): Promise<AdoptResult> {
  const habit = await db
    .prepare("SELECT id FROM habits WHERE id = ?")
    .bind(habitId)
    .first<{ id: string }>();

  if (!habit) return { ok: false, reason: "unknown_habit" };

  const existing = await db
    .prepare(
      "SELECT id FROM user_habits WHERE user_id = ? AND habit_id = ? AND archived_at IS NULL",
    )
    .bind(userId, habitId)
    .first<{ id: string }>();

  if (existing) return { ok: false, reason: "already_adopted" };

  const active = await db
    .prepare("SELECT COUNT(*) AS n FROM user_habits WHERE user_id = ? AND archived_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();

  if ((active?.n ?? 0) >= ACTIVE_HABIT_CAP) return { ok: false, reason: "habit_cap_reached" };

  const userHabitId = crypto.randomUUID();

  await db.batch([
    db
      .prepare("INSERT INTO user_habits (id, user_id, habit_id, level) VALUES (?, ?, ?, 'tiny')")
      .bind(userHabitId, userId, habitId),
    // repair_available starts at 1: the never-miss-twice safety net is a
    // promise from day one, not a reward to be earned (CLAUDE.md §2.4).
    db
      .prepare(
        "INSERT INTO streaks (user_habit_id, current, best, last_completed_date, repair_available, consecutive_since_repair) VALUES (?, 0, 0, NULL, 1, 0)",
      )
      .bind(userHabitId),
    // Close the loop on the suggestion that led here — this is the outcome
    // half of the Phase 3 tuning data.
    db
      .prepare(
        `UPDATE suggestion_log SET outcome = 'adopted'
          WHERE id = (
            SELECT id FROM suggestion_log
             WHERE user_id = ? AND habit_id = ?
             ORDER BY shown_at DESC LIMIT 1
          )`,
      )
      .bind(userId, habitId),
  ]);

  return { ok: true, userHabitId };
}

/** The streak a habit starts life with: nothing done yet, safety net intact. */
const INITIAL_STREAK: StreakState = {
  current: 0,
  best: 0,
  last_completed_date: null,
  repair_available: true,
  consecutive_since_repair: 0,
};

interface StreakRow {
  current: number;
  best: number;
  last_completed_date: string | null;
  repair_available: number;
  consecutive_since_repair: number;
}

function toStreakState(row: StreakRow): StreakState {
  return { ...row, repair_available: row.repair_available === 1 };
}

/** Resolve a user_habit *and* prove the caller owns it, in one query. */
async function ownedUserHabit(
  db: D1Database,
  userId: string,
  userHabitId: string,
): Promise<{ timezone: string } | null> {
  return db
    .prepare(
      `SELECT u.timezone
         FROM user_habits uh
         JOIN users u ON u.id = uh.user_id
        WHERE uh.id = ? AND uh.user_id = ?`,
    )
    .bind(userHabitId, userId)
    .first<{ timezone: string }>();
}

function persistStreak(db: D1Database, userHabitId: string, streak: StreakState) {
  return db
    .prepare(
      `UPDATE streaks
          SET current = ?, best = ?, last_completed_date = ?, repair_available = ?, consecutive_since_repair = ?
        WHERE user_habit_id = ?`,
    )
    .bind(
      streak.current,
      streak.best,
      streak.last_completed_date,
      streak.repair_available ? 1 : 0,
      streak.consecutive_since_repair,
      userHabitId,
    );
}

export type CheckinResult =
  | { ok: true; outcome: CheckinOutcome; streak: StreakState; localDate: string }
  | { ok: false; reason: "not_found" };

/**
 * Record a check-off for the caller's local day.
 *
 * Idempotent by construction: `checkins` is uniquely keyed on
 * (user_habit_id, local_date), so a replayed offline check-in inserts nothing
 * the second time and the streak is left alone. That property is what makes
 * the offline queue safe to flush more than once.
 */
export async function checkIn(
  db: D1Database,
  userId: string,
  userHabitId: string,
  now: Date,
  localDateOverride?: string,
): Promise<CheckinResult> {
  const owned = await ownedUserHabit(db, userId, userHabitId);
  if (!owned) return { ok: false, reason: "not_found" };

  const localDate = localDateOverride ?? localDateFor(now, owned.timezone);

  const insert = await db
    .prepare("INSERT OR IGNORE INTO checkins (id, user_habit_id, local_date) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), userHabitId, localDate)
    .run();

  const row = await db
    .prepare(
      "SELECT current, best, last_completed_date, repair_available, consecutive_since_repair FROM streaks WHERE user_habit_id = ?",
    )
    .bind(userHabitId)
    .first<StreakRow>();

  const existing = row ? toStreakState(row) : INITIAL_STREAK;

  // Nothing inserted means this local date was already recorded — the streak
  // has already accounted for it.
  if (insert.meta.changes === 0) {
    return { ok: true, outcome: "noop", streak: existing, localDate };
  }

  const { streak, outcome } = applyCheckin(existing, localDate);
  await persistStreak(db, userHabitId, streak).run();

  return { ok: true, outcome, streak, localDate };
}

/**
 * Rebuild a streak from its check-in history.
 *
 * Undo can't simply invert the last increment: the check-in it removes may
 * have consumed a repair, reset a streak, or raised `best`. Replaying the whole
 * history through the same pure function is the only way to land on the state
 * the user would have had if today's tap had never happened — and because
 * `applyCheckin` is pure, that replay is exact.
 */
async function recomputeStreak(db: D1Database, userHabitId: string): Promise<StreakState> {
  const { results } = await db
    .prepare("SELECT local_date FROM checkins WHERE user_habit_id = ? ORDER BY local_date ASC")
    .bind(userHabitId)
    .all<{ local_date: string }>();

  let streak = INITIAL_STREAK;
  for (const row of results) {
    streak = applyCheckin(streak, row.local_date).streak;
  }

  await persistStreak(db, userHabitId, streak).run();
  return streak;
}

export type UndoResult =
  | { ok: true; removed: boolean; streak: StreakState }
  | { ok: false; reason: "not_found" };

/** Same-day undo (CLAUDE.md §7). */
export async function undoCheckIn(
  db: D1Database,
  userId: string,
  userHabitId: string,
  now: Date,
): Promise<UndoResult> {
  const owned = await ownedUserHabit(db, userId, userHabitId);
  if (!owned) return { ok: false, reason: "not_found" };

  const localDate = localDateFor(now, owned.timezone);

  const deleted = await db
    .prepare("DELETE FROM checkins WHERE user_habit_id = ? AND local_date = ?")
    .bind(userHabitId, localDate)
    .run();

  const streak = await recomputeStreak(db, userHabitId);

  return { ok: true, removed: deleted.meta.changes > 0, streak };
}

export interface TodayHabit {
  user_habit_id: string;
  habit_id: string;
  title: string;
  category: string;
  level: string;
  tiny_version: string;
  standard_version: string;
  identity_statement: string;
  cue_suggestion: string | null;
  custom_cue: string | null;
  time_of_day: string;
  duration_minutes: number;
  completed: boolean;
  streak: { current: number; best: number; repair_available: boolean };
}

/**
 * The caller's active habits with today's completion state — the data behind
 * the Today screen. "Today" is the user's local day (CLAUDE.md §7), so the
 * completion flag flips at their midnight, not the server's.
 */
export async function getToday(
  db: D1Database,
  userId: string,
  now: Date,
): Promise<TodayHabit[]> {
  const user = await db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .bind(userId)
    .first<{ timezone: string }>();

  if (!user) return [];

  const localDate = localDateFor(now, user.timezone);

  const { results } = await db
    .prepare(
      `SELECT uh.id AS user_habit_id, uh.habit_id, uh.level, uh.custom_cue,
              h.title, h.category, h.tiny_version, h.standard_version,
              h.identity_statement, h.cue_suggestion, h.time_of_day, h.duration_minutes,
              COALESCE(s.current, 0) AS current, COALESCE(s.best, 0) AS best,
              COALESCE(s.repair_available, 1) AS repair_available,
              CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS completed
         FROM user_habits uh
         JOIN habits h ON h.id = uh.habit_id
         LEFT JOIN streaks s ON s.user_habit_id = uh.id
         LEFT JOIN checkins c ON c.user_habit_id = uh.id AND c.local_date = ?
        WHERE uh.user_id = ? AND uh.archived_at IS NULL
        ORDER BY uh.adopted_at ASC, uh.id ASC`,
    )
    .bind(localDate, userId)
    .all<{
      user_habit_id: string;
      habit_id: string;
      level: string;
      custom_cue: string | null;
      title: string;
      category: string;
      tiny_version: string;
      standard_version: string;
      identity_statement: string;
      cue_suggestion: string | null;
      time_of_day: string;
      duration_minutes: number;
      current: number;
      best: number;
      repair_available: number;
      completed: number;
    }>();

  return results.map((row) => ({
    user_habit_id: row.user_habit_id,
    habit_id: row.habit_id,
    title: row.title,
    category: row.category,
    level: row.level,
    tiny_version: row.tiny_version,
    standard_version: row.standard_version,
    identity_statement: row.identity_statement,
    cue_suggestion: row.cue_suggestion,
    custom_cue: row.custom_cue,
    time_of_day: row.time_of_day,
    duration_minutes: row.duration_minutes,
    completed: row.completed === 1,
    streak: {
      current: row.current,
      best: row.best,
      repair_available: row.repair_available === 1,
    },
  }));
}

/**
 * Record that the user passed on a suggestion. The scoring engine's
 * `declinedPenalty` reads exactly this outcome, so a dismissal is what stops a
 * habit being offered again and again.
 */
export async function dismissSuggestion(
  db: D1Database,
  userId: string,
  habitId: string,
): Promise<{ ok: true; dismissed: boolean }> {
  const result = await db
    .prepare(
      `UPDATE suggestion_log SET outcome = 'dismissed'
        WHERE id = (
          SELECT id FROM suggestion_log
           WHERE user_id = ? AND habit_id = ? AND outcome IS NULL
           ORDER BY shown_at DESC LIMIT 1
        )`,
    )
    .bind(userId, habitId)
    .run();

  return { ok: true, dismissed: result.meta.changes > 0 };
}
