import { z } from "zod";
import { CATEGORIES, type Category } from "./habit";

// Built from CATEGORIES so the schema can never drift out of sync with the
// habit library's category list. .strict() rejects both missing and extra
// keys, so "exactly these 12 categories" is enforced structurally.
const categoryScoreShape = Object.fromEntries(
  CATEGORIES.map((category) => [category, z.number().min(0).max(100)]),
) as Record<Category, z.ZodNumber>;

export const CategoryScoresSchema = z.object(categoryScoreShape).strict();

const PREFERRED_TIMES = ["morning", "midday", "evening"] as const;

// CLAUDE.md §5's profile JSON shape. Category keys are the full category
// labels used throughout seed/*.json (e.g. "Exercise & Movement"), not the
// abbreviated keys in CLAUDE.md's illustrative example, so this lines up
// exactly with Habit.category.
export const ProfileSchema = z.object({
  category_scores: CategoryScoresSchema,
  capacity_minutes_per_day: z.number().int().positive(),
  preferred_times: z.array(z.enum(PREFERRED_TIMES)),
  identity_goals: z.array(z.string().min(1)),
  avoid_tags: z.array(z.string().min(1)),
  notes: z.string(),
});

export type Profile = z.infer<typeof ProfileSchema>;
