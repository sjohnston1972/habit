import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config.js";
import { CATEGORY_COLORS, categoryToken } from "../../src/app/category-colors";
import { CATEGORIES } from "../../src/shared/habit";
import { ALL_HABITS } from "../../src/shared/seed-data";

const tokens = (
  tailwindConfig as unknown as {
    theme: { extend: { colors: { category: Record<string, string> } } };
  }
).theme.extend.colors.category;

describe("category colours", () => {
  it("maps every category in the habit library", () => {
    const habitCategories = new Set(ALL_HABITS.map((habit) => habit.category));

    for (const category of habitCategories) {
      expect(CATEGORY_COLORS[category]).toBeTruthy();
    }
  });

  it("maps all 12 categories and no others", () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([...CATEGORIES].sort());
  });

  it("names only tokens that exist in tailwind.config.js", () => {
    for (const token of Object.values(CATEGORY_COLORS)) {
      expect(tokens[token]).toBeTruthy();
    }
  });

  it("gives each category its own colour", () => {
    const used = Object.values(CATEGORY_COLORS);

    expect(new Set(used).size).toBe(used.length);
  });

  it("uses every token the palette defines — no orphans left over from run 1", () => {
    expect(Object.values(CATEGORY_COLORS).sort()).toEqual(Object.keys(tokens).sort());
  });

  it("falls back to a usable token for an unknown category rather than throwing", () => {
    expect(categoryToken("Not A Real Category")).toBeTruthy();
    expect(tokens[categoryToken("Not A Real Category")]).toBeTruthy();
  });
});
