import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_HABITS, LIBRARY_VERSION } from "../src/shared/seed-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function sqlValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function buildSeedSql(): string {
  const statements = ["DELETE FROM habits;"];

  for (const habit of ALL_HABITS) {
    const values = [
      sqlValue(crypto.randomUUID()),
      sqlValue(LIBRARY_VERSION),
      sqlValue(habit.title),
      sqlValue(habit.category),
      sqlValue(JSON.stringify(habit.tags)),
      sqlValue(habit.identity_statement),
      sqlValue(habit.tiny_version),
      sqlValue(habit.standard_version),
      sqlValue(habit.ambitious_version),
      sqlValue(habit.cue_suggestion),
      sqlValue(habit.time_of_day),
      sqlValue(habit.duration_minutes),
      sqlValue(habit.difficulty),
      sqlValue(habit.frequency_default),
      sqlValue(JSON.stringify(habit.stack_anchors)),
      sqlValue(habit.prerequisites),
    ].join(", ");

    statements.push(
      `INSERT INTO habits (id, library_version, title, category, tags, identity_statement, tiny_version, standard_version, ambitious_version, cue_suggestion, time_of_day, duration_minutes, difficulty, frequency_default, stack_anchors, prerequisites) VALUES (${values});`,
    );
  }

  return statements.join("\n");
}

function main() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "habit-seed-"));
  const sqlPath = path.join(tmpDir, "seed.sql");

  try {
    writeFileSync(sqlPath, buildSeedSql(), "utf8");

    const wranglerBin = path.join(PROJECT_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

    execFileSync(
      process.execPath,
      [wranglerBin, "d1", "execute", "habit-db", "--local", "--file", sqlPath],
      { cwd: PROJECT_ROOT, stdio: "inherit" },
    );

    console.log(`\nSeeded ${ALL_HABITS.length} habits (library_version ${LIBRARY_VERSION}) into the local D1 database.`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
