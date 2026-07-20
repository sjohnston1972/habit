import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/shared/default-profile";
import type { Profile } from "../src/shared/profile";
import { scoreHabit, type ScorableHabit, type ScoringContext } from "../src/shared/scoring";
import { WEIGHTS } from "../src/shared/weights";

/**
 * A deliberately neutral fixture: every term sits at a known value, so a test
 * that changes one input is changing exactly one term.
 */
const BASE_HABIT: ScorableHabit = {
  id: "habit-1",
  title: "Walk around the block",
  category: "Exercise & Movement",
  tags: ["walking"],
  identity_statement: "I'm someone who moves every day",
  tiny_version: "Put your shoes on",
  standard_version: "Walk around the block",
  time_of_day: "morning",
  duration_minutes: 15,
  difficulty: 1,
  frequency_default: "daily",
  stack_anchors: [],
};

const BASE_CONTEXT: ScoringContext = {
  bucket: "morning",
  activeCountByCategory: {},
  recentlySuggestedHabitIds: new Set(),
  declinedHabitIds: new Set(),
  maxCurrentStreak: 0,
};

function profileWith(overrides: Partial<Profile>): Profile {
  return { ...DEFAULT_PROFILE, ...overrides };
}

function withCategoryScore(category: keyof Profile["category_scores"], value: number): Profile {
  return profileWith({
    category_scores: { ...DEFAULT_PROFILE.category_scores, [category]: value },
  });
}

describe("scoreHabit — category fit", () => {
  it("is the profile's category score normalised to 0..1, then weighted", () => {
    const profile = withCategoryScore("Exercise & Movement", 100);

    const { breakdown } = scoreHabit(BASE_HABIT, profile, BASE_CONTEXT);

    expect(breakdown.categoryFit).toBe(WEIGHTS.categoryFit);
  });

  it("contributes nothing when the user scores the category at zero", () => {
    const profile = withCategoryScore("Exercise & Movement", 0);

    const { breakdown } = scoreHabit(BASE_HABIT, profile, BASE_CONTEXT);

    expect(breakdown.categoryFit).toBe(0);
  });

  it("scales linearly between", () => {
    const profile = withCategoryScore("Exercise & Movement", 50);

    const { breakdown } = scoreHabit(BASE_HABIT, profile, BASE_CONTEXT);

    expect(breakdown.categoryFit).toBeCloseTo(WEIGHTS.categoryFit * 0.5);
  });
});

describe("scoreHabit — time match", () => {
  it("is full when the habit's time of day is the current bucket", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.timeMatch).toBe(WEIGHTS.timeMatch);
  });

  it("is full for an anytime habit regardless of bucket", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, time_of_day: "anytime" };

    const { breakdown } = scoreHabit(habit, DEFAULT_PROFILE, { ...BASE_CONTEXT, bucket: "evening" });

    expect(breakdown.timeMatch).toBe(WEIGHTS.timeMatch);
  });

  it("is zero when the habit belongs to a different part of the day", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      bucket: "evening",
    });

    expect(breakdown.timeMatch).toBe(0);
  });
});

describe("scoreHabit — capacity fit", () => {
  const profile = profileWith({ capacity_minutes_per_day: 20 });

  it("is full when the habit fits inside the user's capacity", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, duration_minutes: 10 };

    const { breakdown } = scoreHabit(habit, profile, BASE_CONTEXT);

    expect(breakdown.capacityFit).toBe(WEIGHTS.capacityFit);
  });

  it("is full at exactly the user's capacity", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, duration_minutes: 20 };

    const { breakdown } = scoreHabit(habit, profile, BASE_CONTEXT);

    expect(breakdown.capacityFit).toBe(WEIGHTS.capacityFit);
  });

  it("falls off linearly to half-value at 1.5x capacity", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, duration_minutes: 30 };

    const { breakdown } = scoreHabit(habit, profile, BASE_CONTEXT);

    expect(breakdown.capacityFit).toBeCloseTo(WEIGHTS.capacityFit * 0.5);
  });

  it("reaches zero at twice capacity", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, duration_minutes: 40 };

    const { breakdown } = scoreHabit(habit, profile, BASE_CONTEXT);

    expect(breakdown.capacityFit).toBe(0);
  });

  it("clamps at zero rather than going negative beyond twice capacity", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, duration_minutes: 120 };

    const { breakdown } = scoreHabit(habit, profile, BASE_CONTEXT);

    expect(breakdown.capacityFit).toBe(0);
  });
});

describe("scoreHabit — balance bonus", () => {
  it("is full for a category the user has no active habits in", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.balanceBonus).toBe(WEIGHTS.balanceBonus);
  });

  it("halves once the user has one active habit in the category", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      activeCountByCategory: { "Exercise & Movement": 1 },
    });

    expect(breakdown.balanceBonus).toBeCloseTo(WEIGHTS.balanceBonus * 0.5);
  });

  it("keeps shrinking as a category fills up", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      activeCountByCategory: { "Exercise & Movement": 3 },
    });

    expect(breakdown.balanceBonus).toBeCloseTo(WEIGHTS.balanceBonus * 0.25);
  });

  it("ignores active habits in other categories", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      activeCountByCategory: { "Sleep & Rest": 4 },
    });

    expect(breakdown.balanceBonus).toBe(WEIGHTS.balanceBonus);
  });
});

describe("scoreHabit — novelty", () => {
  it("is full for a habit not suggested recently", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.novelty).toBe(WEIGHTS.novelty);
  });

  it("is zero for a habit suggested within the recency window", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      recentlySuggestedHabitIds: new Set(["habit-1"]),
    });

    expect(breakdown.novelty).toBe(0);
  });
});

describe("scoreHabit — progression", () => {
  it("favours the easiest habits for a user with no streak yet", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.progression).toBe(WEIGHTS.progression);
  });

  it("gives an untested user no credit for the hardest habits", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, difficulty: 3 };

    const { breakdown } = scoreHabit(habit, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.progression).toBe(0);
  });

  it("favours mid-difficulty habits once a streak is established", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, difficulty: 2 };

    const { breakdown } = scoreHabit(habit, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      maxCurrentStreak: 7,
    });

    expect(breakdown.progression).toBe(WEIGHTS.progression);
  });

  it("favours the hardest habits for a mature streak", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, difficulty: 3 };

    const { breakdown } = scoreHabit(habit, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      maxCurrentStreak: 30,
    });

    expect(breakdown.progression).toBe(WEIGHTS.progression);
  });

  it("gives partial credit for being one difficulty step away from ideal", () => {
    const habit: ScorableHabit = { ...BASE_HABIT, difficulty: 1 };

    const { breakdown } = scoreHabit(habit, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      maxCurrentStreak: 7,
    });

    expect(breakdown.progression).toBeCloseTo(WEIGHTS.progression * 0.5);
  });
});

describe("scoreHabit — declined penalty", () => {
  it("is zero for a habit the user has never dismissed", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);

    expect(breakdown.declinedPenalty).toBe(0);
  });

  it("applies the full penalty for a previously dismissed habit", () => {
    const { breakdown } = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      declinedHabitIds: new Set(["habit-1"]),
    });

    expect(breakdown.declinedPenalty).toBe(WEIGHTS.declinedPenalty);
  });

  it("subtracts the penalty from the total rather than adding it", () => {
    const clean = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, BASE_CONTEXT);
    const declined = scoreHabit(BASE_HABIT, DEFAULT_PROFILE, {
      ...BASE_CONTEXT,
      declinedHabitIds: new Set(["habit-1"]),
    });

    expect(declined.score).toBeCloseTo(clean.score - WEIGHTS.declinedPenalty);
  });
});

describe("scoreHabit — the total", () => {
  it("is the sum of the positive terms minus the penalty, so a breakdown always explains its score", () => {
    const profile = withCategoryScore("Exercise & Movement", 70);
    const { score, breakdown } = scoreHabit(BASE_HABIT, profile, {
      ...BASE_CONTEXT,
      activeCountByCategory: { "Exercise & Movement": 2 },
      declinedHabitIds: new Set(["habit-1"]),
    });

    const expected =
      breakdown.categoryFit +
      breakdown.timeMatch +
      breakdown.capacityFit +
      breakdown.balanceBonus +
      breakdown.novelty +
      breakdown.progression -
      breakdown.declinedPenalty;

    expect(score).toBeCloseTo(expected);
  });

  it("is deterministic — identical inputs produce identical output", () => {
    const profile = withCategoryScore("Exercise & Movement", 63);
    const context: ScoringContext = {
      bucket: "midday",
      activeCountByCategory: { "Exercise & Movement": 1, "Sleep & Rest": 2 },
      recentlySuggestedHabitIds: new Set(["habit-9"]),
      declinedHabitIds: new Set(["habit-4"]),
      maxCurrentStreak: 12,
    };

    const first = scoreHabit(BASE_HABIT, profile, context);
    const second = scoreHabit(BASE_HABIT, profile, context);

    expect(first).toEqual(second);
  });

  it("does not mutate the habit, profile, or context it is given", () => {
    const profile = withCategoryScore("Exercise & Movement", 70);
    const habitSnapshot = structuredClone(BASE_HABIT);
    const profileSnapshot = structuredClone(profile);

    scoreHabit(BASE_HABIT, profile, BASE_CONTEXT);

    expect(BASE_HABIT).toEqual(habitSnapshot);
    expect(profile).toEqual(profileSnapshot);
  });
});
