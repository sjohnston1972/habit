import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/shared/default-profile";
import { ProfileSchema } from "../src/shared/profile";
import { ALL_HABITS } from "../src/shared/seed-data";

describe("DEFAULT_PROFILE", () => {
  it("parses against ProfileSchema", () => {
    expect(() => ProfileSchema.parse(DEFAULT_PROFILE)).not.toThrow();
  });

  it("has exactly 12 category keys", () => {
    expect(Object.keys(DEFAULT_PROFILE.category_scores)).toHaveLength(12);
  });

  it("uses only category keys that appear as a category in ALL_HABITS", () => {
    const habitCategories = new Set(ALL_HABITS.map((habit) => habit.category));

    for (const key of Object.keys(DEFAULT_PROFILE.category_scores)) {
      expect(habitCategories.has(key as (typeof ALL_HABITS)[number]["category"])).toBe(true);
    }
  });
});
