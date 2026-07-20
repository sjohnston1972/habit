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

export const ALL_HABITS: Habit[] = RAW_SEED_ENTRIES.map((entry) => HabitSchema.parse(entry));
