import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, HabitSchema } from "../src/shared/habit";
import { deriveHabitId } from "../src/shared/seed-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "seed");

function main() {
  const files = readdirSync(SEED_DIR).filter((name) => name.endsWith(".json"));

  let errorCount = 0;
  let totalHabits = 0;
  const countByCategory = new Map<string, number>();
  const titleToFiles = new Map<string, string[]>();
  const idToTitles = new Map<string, string[]>();

  for (const file of files) {
    const filePath = path.join(SEED_DIR, file);
    const raw = readFileSync(filePath, "utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`✗ ${file}: invalid JSON — ${(err as Error).message}`);
      errorCount++;
      continue;
    }

    if (!Array.isArray(parsed)) {
      console.error(`✗ ${file}: expected a JSON array of habits`);
      errorCount++;
      continue;
    }

    parsed.forEach((entry, index) => {
      const result = HabitSchema.safeParse(entry);
      if (!result.success) {
        errorCount++;
        console.error(`✗ ${file}[${index}]:`);
        for (const issue of result.error.issues) {
          console.error(`    ${issue.path.join(".")}: ${issue.message}`);
        }
        return;
      }

      const habit = result.data;
      totalHabits++;
      countByCategory.set(habit.category, (countByCategory.get(habit.category) ?? 0) + 1);

      const existing = titleToFiles.get(habit.title) ?? [];
      existing.push(file);
      titleToFiles.set(habit.title, existing);

      // Habit ids are title slugs and must be unique — two titles slugging to
      // the same id would collide on seed (one silently overwriting the other).
      const id = deriveHabitId(habit.title);
      const titlesForId = idToTitles.get(id) ?? [];
      titlesForId.push(habit.title);
      idToTitles.set(id, titlesForId);
    });
  }

  const duplicateTitles = [...titleToFiles.entries()].filter(([, files]) => files.length > 1);
  for (const [title, files] of duplicateTitles) {
    errorCount++;
    console.error(`✗ duplicate title "${title}" found in: ${files.join(", ")}`);
  }

  const idCollisions = [...idToTitles.entries()].filter(
    ([, titles]) => new Set(titles).size > 1,
  );
  for (const [id, titles] of idCollisions) {
    errorCount++;
    console.error(`✗ id collision "${id}" from distinct titles: ${[...new Set(titles)].join(", ")}`);
  }

  console.log("");
  console.log(`Seed files scanned: ${files.length}`);
  console.log(`Total habits: ${totalHabits}`);
  console.log("By category:");
  for (const category of CATEGORIES) {
    console.log(`  ${category}: ${countByCategory.get(category) ?? 0}`);
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} problem(s) found.`);
    process.exit(1);
  }

  console.log("\nLibrary valid.");
}

main();
