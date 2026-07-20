import type { Habit } from "./habit";
import type { Profile } from "./profile";
import type { Bucket } from "./time-of-day";
import { WEIGHTS } from "./weights";

/**
 * The deterministic half of the daily loop (CLAUDE.md §6). A pure function over
 * plain data — no D1, no clock, no I/O — so every term is unit-testable and the
 * same inputs always produce the same score.
 */

/** A library habit as it exists in D1: the seed shape plus its primary key. */
export type ScorableHabit = Habit & { id: string };

/**
 * Each term's *weighted* contribution, so the parts always sum to the whole and
 * a logged breakdown explains its own score without needing the weights that
 * produced it. Divide by the matching weight to recover the raw 0..1 term.
 */
export interface ScoreBreakdown {
  categoryFit: number;
  timeMatch: number;
  capacityFit: number;
  balanceBonus: number;
  novelty: number;
  progression: number;
  declinedPenalty: number;
}

export interface ScoringContext {
  bucket: Bucket;
  activeCountByCategory: Record<string, number>;
  /** Habit ids suggested in the last 14 days. */
  recentlySuggestedHabitIds: ReadonlySet<string>;
  /** Habit ids the user has dismissed before. */
  declinedHabitIds: ReadonlySet<string>;
  /** The user's longest current streak — a proxy for how established the habit practice is. */
  maxCurrentStreak: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How well the habit's length fits the day the user says they have: full credit
 * up to their capacity, then a linear fall-off to nothing at twice capacity.
 */
function capacityFit(habit: ScorableHabit, profile: Profile): number {
  const capacity = profile.capacity_minutes_per_day;
  const overage = habit.duration_minutes - capacity;

  if (overage <= 0) return 1;

  return clamp01(1 - overage / capacity);
}

/**
 * Which difficulty suits the user right now. Atomic Habits' "progression, not
 * overload" (CLAUDE.md §2.6): start tiny, and only reach for harder habits once
 * a streak proves the practice has stuck.
 */
function idealDifficulty(maxCurrentStreak: number): 1 | 2 | 3 {
  if (maxCurrentStreak >= 30) return 3;
  if (maxCurrentStreak >= 7) return 2;
  return 1;
}

export function scoreHabit(
  habit: ScorableHabit,
  profile: Profile,
  ctx: ScoringContext,
): { score: number; breakdown: ScoreBreakdown } {
  const categoryScore = profile.category_scores[habit.category] ?? 0;

  // "anytime" habits never fight the clock — they fit whatever bucket we're in.
  const timeMatches = habit.time_of_day === "anytime" || habit.time_of_day === ctx.bucket;

  // 1 / (1 + n): a category the user has nothing in gets full credit, and each
  // habit already held there halves the pull, so suggestions spread across life
  // areas instead of piling into whatever category scores highest.
  const activeInCategory = ctx.activeCountByCategory[habit.category] ?? 0;

  const difficultyGap = Math.abs(habit.difficulty - idealDifficulty(ctx.maxCurrentStreak));

  const breakdown: ScoreBreakdown = {
    categoryFit: WEIGHTS.categoryFit * clamp01(categoryScore / 100),
    timeMatch: WEIGHTS.timeMatch * (timeMatches ? 1 : 0),
    capacityFit: WEIGHTS.capacityFit * capacityFit(habit, profile),
    balanceBonus: WEIGHTS.balanceBonus * (1 / (1 + activeInCategory)),
    novelty: WEIGHTS.novelty * (ctx.recentlySuggestedHabitIds.has(habit.id) ? 0 : 1),
    // Gap of 0 → full, 1 → half, 2 → nothing.
    progression: WEIGHTS.progression * clamp01(1 - difficultyGap / 2),
    declinedPenalty: WEIGHTS.declinedPenalty * (ctx.declinedHabitIds.has(habit.id) ? 1 : 0),
  };

  const score =
    breakdown.categoryFit +
    breakdown.timeMatch +
    breakdown.capacityFit +
    breakdown.balanceBonus +
    breakdown.novelty +
    breakdown.progression -
    breakdown.declinedPenalty;

  return { score, breakdown };
}
