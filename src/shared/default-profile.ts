import { CATEGORIES, type Category } from "./habit";
import type { Profile } from "./profile";

const DEFAULT_CATEGORY_SCORES = Object.fromEntries(
  CATEGORIES.map((category) => [category, 50]),
) as Record<Category, number>;

// What the suggestion engine reads before onboarding has ever run (CLAUDE.md
// §5/§6) — every category at a neutral midpoint, a conservative capacity, and
// no preferences yet.
export const DEFAULT_PROFILE: Profile = {
  category_scores: DEFAULT_CATEGORY_SCORES,
  capacity_minutes_per_day: 15,
  preferred_times: ["morning", "evening"],
  identity_goals: [],
  avoid_tags: [],
  notes: "",
};
