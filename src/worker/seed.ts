import { ALL_HABITS, LIBRARY_VERSION, type SeedHabit } from "@shared/seed-data";

export { ALL_HABITS, LIBRARY_VERSION };

// Upsert by the habit's stable id rather than DELETE-then-INSERT: re-seeding
// (e.g. to add or reword habits) updates rows in place and never removes a
// habit a user may have adopted, so `user_habits`/`suggestion_log` references
// survive. Idempotent — a re-run with the same library is a no-op on row
// count. Habits dropped from the library are intentionally left in place
// (archival, not deletion, is the eventual path) to avoid cascading away user
// data.
const UPSERT_SQL = `
  INSERT INTO habits (
    id, library_version, title, category, tags, identity_statement,
    tiny_version, standard_version, ambitious_version, cue_suggestion,
    time_of_day, duration_minutes, difficulty, frequency_default,
    stack_anchors, prerequisites
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    library_version = excluded.library_version,
    title = excluded.title,
    category = excluded.category,
    tags = excluded.tags,
    identity_statement = excluded.identity_statement,
    tiny_version = excluded.tiny_version,
    standard_version = excluded.standard_version,
    ambitious_version = excluded.ambitious_version,
    cue_suggestion = excluded.cue_suggestion,
    time_of_day = excluded.time_of_day,
    duration_minutes = excluded.duration_minutes,
    difficulty = excluded.difficulty,
    frequency_default = excluded.frequency_default,
    stack_anchors = excluded.stack_anchors,
    prerequisites = excluded.prerequisites
`;

export async function seedHabits(
  db: D1Database,
  habits: SeedHabit[] = ALL_HABITS,
  libraryVersion: number = LIBRARY_VERSION,
): Promise<number> {
  if (habits.length === 0) {
    return 0;
  }

  const insert = db.prepare(UPSERT_SQL);
  const statements = habits.map((habit) =>
    insert.bind(
      habit.id,
      libraryVersion,
      habit.title,
      habit.category,
      JSON.stringify(habit.tags),
      habit.identity_statement,
      habit.tiny_version,
      habit.standard_version,
      habit.ambitious_version ?? null,
      habit.cue_suggestion ?? null,
      habit.time_of_day,
      habit.duration_minutes,
      habit.difficulty,
      habit.frequency_default,
      JSON.stringify(habit.stack_anchors),
      habit.prerequisites ?? null,
    ),
  );

  await db.batch(statements);
  return habits.length;
}
