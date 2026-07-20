import { z } from "zod";

// The 12 categories from CLAUDE.md §4. Keep this list in sync with the
// `seed/` directory — one JSON file per category.
export const CATEGORIES = [
  "Exercise & Movement",
  "Nutrition & Hydration",
  "Sleep & Rest",
  "Mental Health & Mindfulness",
  "Home & Housework",
  "Money & Admin",
  "Relationships & Social",
  "Work & Focus",
  "Learning & Growth",
  "Digital Hygiene",
  "Outdoors & Nature",
  "Health & Self-care",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const TIME_OF_DAY = ["morning", "midday", "evening", "anytime"] as const;

export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export const HabitSchema = z.object({
  title: z.string().min(1),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().min(1)).default([]),
  identity_statement: z.string().min(1),
  tiny_version: z.string().min(1),
  standard_version: z.string().min(1),
  ambitious_version: z.string().min(1).optional(),
  cue_suggestion: z.string().min(1).optional(),
  time_of_day: z.enum(TIME_OF_DAY),
  duration_minutes: z.number().int().positive(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  frequency_default: z.string().min(1).default("daily"),
  stack_anchors: z.array(z.string().min(1)).default([]),
  prerequisites: z.string().min(1).nullable().optional(),
});

export type Habit = z.infer<typeof HabitSchema>;
