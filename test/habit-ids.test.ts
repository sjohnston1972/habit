import { describe, expect, it } from "vitest";
import { ALL_HABITS, deriveHabitId } from "../src/shared/seed-data";

describe("deriveHabitId", () => {
  it("is stable — the same title always yields the same id", () => {
    expect(deriveHabitId("Read before bed")).toBe(deriveHabitId("Read before bed"));
  });

  it("is a readable slug, not an opaque uuid", () => {
    expect(deriveHabitId("Read before bed")).toBe("read-before-bed");
  });

  it("collapses punctuation and case so ids stay url- and log-friendly", () => {
    expect(deriveHabitId("Walk 10,000 steps!")).toBe("walk-10-000-steps");
    expect(deriveHabitId("  Drink water  ")).toBe("drink-water");
  });
});

describe("ALL_HABITS ids", () => {
  it("gives every habit a non-empty deterministic id", () => {
    for (const habit of ALL_HABITS) {
      expect(habit.id).toBeTruthy();
      expect(habit.id).toBe(deriveHabitId(habit.title));
    }
  });

  it("has no id collisions across the whole library", () => {
    const ids = ALL_HABITS.map((habit) => habit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
