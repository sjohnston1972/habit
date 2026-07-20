/**
 * The never-miss-twice rule (CLAUDE.md §2.4), as a pure function so every
 * branch is testable without a database or a clock. All dates are `YYYY-MM-DD`
 * in the *user's* timezone — the caller is responsible for that conversion.
 */

/** Consecutive completed days required to earn the repair back once it's spent. */
const REPAIR_REGENERATION_DAYS = 7;

export interface StreakState {
  current: number;
  best: number;
  last_completed_date: string | null;
  repair_available: boolean;
  consecutive_since_repair: number;
}

export type CheckinOutcome = "incremented" | "repaired" | "reset" | "noop";

/** Whole days from one local date to another. Both are calendar dates, so UTC midnight is exact. */
function daysBetween(from: string, to: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return (parse(to) - parse(from)) / 86_400_000;
}

export function applyCheckin(
  streak: StreakState,
  localDate: string,
): { streak: StreakState; outcome: CheckinOutcome } {
  const gap =
    streak.last_completed_date === null ? null : daysBetween(streak.last_completed_date, localDate);

  // Same day, or a stale check-in arriving after a later one — an offline queue
  // can flush Tuesday's check-off on Wednesday. Neither should move the streak.
  if (gap !== null && gap <= 0) {
    return { streak, outcome: "noop" };
  }

  const completed = (next: StreakState, outcome: CheckinOutcome) => ({
    streak: { ...next, best: Math.max(next.best, next.current), last_completed_date: localDate },
    outcome,
  });

  // A fresh start hands the repair back: the safety net is a promise, not a
  // reward to be re-earned after every stumble.
  const reset = (): StreakState => ({
    ...streak,
    current: 1,
    repair_available: true,
    consecutive_since_repair: 0,
  });

  if (gap === null) {
    return completed({ ...streak, current: 1 }, "incremented");
  }

  if (gap === 2 && streak.repair_available) {
    // The repair day itself is day zero of the regeneration count.
    return completed(
      { ...streak, current: streak.current + 1, repair_available: false, consecutive_since_repair: 0 },
      "repaired",
    );
  }

  if (gap > 1) {
    return completed(reset(), "reset");
  }

  // gap === 1: an ordinary consecutive day.
  const counted = streak.repair_available
    ? streak.consecutive_since_repair
    : streak.consecutive_since_repair + 1;
  const regenerated = counted >= REPAIR_REGENERATION_DAYS;

  return completed(
    {
      ...streak,
      current: streak.current + 1,
      repair_available: streak.repair_available || regenerated,
      consecutive_since_repair: regenerated ? 0 : counted,
    },
    "incremented",
  );
}
