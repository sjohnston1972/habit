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
