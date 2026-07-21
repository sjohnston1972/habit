import { HabitSchema, type Habit } from "./habit";
import exerciseMovement from "../../seed/exercise-movement.json";
import nutritionHydration from "../../seed/nutrition-hydration.json";
import sleepRest from "../../seed/sleep-rest.json";
import mentalHealthMindfulness from "../../seed/mental-health-mindfulness.json";
import homeHousework from "../../seed/home-housework.json";
import moneyAdmin from "../../seed/money-admin.json";
import relationshipsSocial from "../../seed/relationships-social.json";
import workFocus from "../../seed/work-focus.json";
import learningGrowth from "../../seed/learning-growth.json";
import digitalHygiene from "../../seed/digital-hygiene.json";
import outdoorsNature from "../../seed/outdoors-nature.json";
import healthSelfCare from "../../seed/health-self-care.json";

// Bumping this replaces the whole library on the next seed run (CLAUDE.md §4:
// "versioned so it can be extended without touching user data").
export const LIBRARY_VERSION = 1;

const RAW_SEED_ENTRIES: unknown[] = [
  ...exerciseMovement,
  ...nutritionHydration,
  ...sleepRest,
  ...mentalHealthMindfulness,
  ...homeHousework,
  ...moneyAdmin,
  ...relationshipsSocial,
  ...workFocus,
  ...learningGrowth,
  ...digitalHygiene,
  ...outdoorsNature,
  ...healthSelfCare,
];

/** A library habit as it lives in D1: the seed shape plus its stable primary key. */
export type SeedHabit = Habit & { id: string };

/**
 * A habit's primary key, derived deterministically from its title.
 *
 * Ids must be stable across re-seeds: `user_habits` and `suggestion_log` rows
 * point at them, and the seed loader upserts by id, so a random id per seed
 * would orphan user data every time the library was rebuilt. A title slug is
 * stable, readable in logs, and — because titles are already globally unique
 * (enforced by `validate:library`) — collision-free in practice, with the
 * assertion below as the backstop.
 */
export function deriveHabitId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const ALL_HABITS: SeedHabit[] = RAW_SEED_ENTRIES.map((entry) => {
  const habit = HabitSchema.parse(entry);
  return { ...habit, id: deriveHabitId(habit.title) };
});

// Fail loudly at load if two titles ever slug to the same id — a silent
// collision would let one habit's id overwrite another's on seed.
const seenIds = new Set<string>();
for (const habit of ALL_HABITS) {
  if (seenIds.has(habit.id)) {
    throw new Error(`Duplicate habit id "${habit.id}" derived from title "${habit.title}"`);
  }
  seenIds.add(habit.id);
}
