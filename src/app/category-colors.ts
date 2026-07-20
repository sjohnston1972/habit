import { CATEGORIES, type Category } from "../shared/habit";

/**
 * Each of the 12 categories gets its own accent (CLAUDE.md §10). The values are
 * the `category.*` token names from `tailwind.config.js` — kept as names rather
 * than hex codes so the palette has exactly one home.
 */
export const CATEGORY_COLORS: Record<Category, string> = {
  "Exercise & Movement": "exercise",
  "Nutrition & Hydration": "nutrition",
  "Sleep & Rest": "sleep",
  "Mental Health & Mindfulness": "mindfulness",
  "Home & Housework": "home",
  "Money & Admin": "money",
  "Relationships & Social": "relationships",
  "Work & Focus": "work",
  "Learning & Growth": "learning",
  "Digital Hygiene": "digital",
  "Outdoors & Nature": "outdoors",
  "Health & Self-care": "selfcare",
};

/** Anything unrecognised borrows the calmest accent rather than rendering colourless. */
const FALLBACK_TOKEN = "digital";

export function categoryToken(category: string): string {
  return CATEGORY_COLORS[category as Category] ?? FALLBACK_TOKEN;
}

export function isKnownCategory(category: string): category is Category {
  return (CATEGORIES as readonly string[]).includes(category);
}
