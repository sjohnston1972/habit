import type { Habit } from "@shared/habit";
import { ALL_HABITS, LIBRARY_VERSION } from "@shared/seed-data";

export { ALL_HABITS, LIBRARY_VERSION };

const INSERT_SQL = `
  INSERT INTO habits (
    id, library_version, title, category, tags, identity_statement,
    tiny_version, standard_version, ambitious_version, cue_suggestion,
    time_of_day, duration_minutes, difficulty, frequency_default,
    stack_anchors, prerequisites
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Idempotent: every run replaces the whole library rather than appending to
// it, so re-seeding never produces duplicate rows (CLAUDE.md §4).
export async function seedHabits(
  db: D1Database,
  habits: Habit[] = ALL_HABITS,
  libraryVersion: number = LIBRARY_VERSION,
): Promise<number> {
  await db.prepare("DELETE FROM habits").run();

  if (habits.length === 0) {
    return 0;
  }

  const insert = db.prepare(INSERT_SQL);
  const statements = habits.map((habit) =>
    insert.bind(
      crypto.randomUUID(),
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
