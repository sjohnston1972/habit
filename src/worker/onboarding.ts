import { CATEGORIES } from "../shared/habit";
import type { Profile } from "../shared/profile";
import { extractProfile, type ProfileClient, type TranscriptTurn } from "./claude";

/**
 * The onboarding interview (CLAUDE.md §5).
 *
 * The questions are a fixed, tappable-first script rather than model-generated
 * turns (CLAUDE.md §15 #3). That is deliberate: the interview is the same for
 * everyone, so generating it per user would spend tokens on a solved problem
 * and make the flow non-deterministic. The model is called **once**, at the
 * end, to turn the answers into a structured profile — which is the part that
 * genuinely needs judgement.
 */

/** CLAUDE.md §5: max 3 AI sessions per user per day. */
export const MAX_SESSIONS_PER_DAY = 3;

export interface Question {
  id: string;
  prompt: string;
  options: string[];
  /** Whether the UI should offer a free-text box alongside the taps. */
  allowFreeText: boolean;
  multiSelect?: boolean;
}

// 9 questions: inside CLAUDE.md §5's 8-12 range, tappable-first, with free
// text only where a canned option genuinely can't capture the answer.
export const QUESTIONS: Question[] = [
  {
    id: "weekday_shape",
    prompt: "What does a typical weekday morning look like for you?",
    options: ["Up early, unhurried", "Rushed", "Varies a lot", "I work nights"],
    allowFreeText: true,
  },
  {
    id: "neglected_area",
    prompt: "Which area of life feels most neglected right now?",
    options: [...CATEGORIES],
    allowFreeText: false,
    multiSelect: true,
  },
  {
    id: "capacity",
    prompt: "Realistically, how much time can you give a new habit each day?",
    options: ["2 minutes", "10 minutes", "20 minutes", "30 minutes or more"],
    allowFreeText: false,
  },
  {
    id: "preferred_times",
    prompt: "When are you most likely to actually follow through?",
    options: ["Morning", "Midday", "Evening"],
    allowFreeText: false,
    multiSelect: true,
  },
  {
    id: "identity",
    prompt: "Finish this: in a year, I want to be someone who…",
    options: [
      "moves every day",
      "sleeps properly",
      "keeps on top of things",
      "keeps learning",
      "looks after their people",
    ],
    allowFreeText: true,
    multiSelect: true,
  },
  {
    id: "avoid",
    prompt: "Anything you'd rather we never suggest?",
    options: ["Running", "Early mornings", "Anything social", "Nothing comes to mind"],
    allowFreeText: true,
    multiSelect: true,
  },
  {
    id: "past_attempts",
    prompt: "When a habit has stalled before, what usually got in the way?",
    options: ["No time", "Forgot", "Lost motivation", "Life got chaotic"],
    allowFreeText: true,
  },
  {
    id: "anchors",
    prompt: "Which of these already happen every day without fail?",
    options: ["Morning coffee", "Brushing teeth", "Commute", "Dinner", "Getting into bed"],
    allowFreeText: false,
    multiSelect: true,
  },
  {
    id: "anything_else",
    prompt: "Anything else we should know about your week?",
    options: ["Nothing to add"],
    allowFreeText: true,
  },
];

export type TurnResult =
  | { ok: true; done: false; sessionId: string; question: Question; index: number; total: number }
  | { ok: true; done: true; sessionId: string; profile: Profile; usedFallback: boolean }
  | { ok: false; reason: "rate_limited" | "not_found" | "already_complete" };

function startOfLocalDayIso(now: Date): string {
  // UTC day boundary is fine for a per-day cap — it's a cost guard, not a
  // user-facing "today" (unlike streaks, which must use the user's zone).
  return `${now.toISOString().slice(0, 10)} 00:00:00`;
}

async function countSessionsToday(db: D1Database, userId: string, now: Date): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM qa_sessions WHERE user_id = ? AND type = 'onboarding' AND created_at >= ?",
    )
    .bind(userId, startOfLocalDayIso(now))
    .first<{ n: number }>();

  return row?.n ?? 0;
}

interface StoredTranscript {
  answers: { question_id: string; prompt: string; answer: string }[];
  complete?: boolean;
}

async function loadSession(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<StoredTranscript | null> {
  // Scoped by user_id: one user can never resume another's interview.
  const row = await db
    .prepare("SELECT transcript FROM qa_sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, userId)
    .first<{ transcript: string }>();

  if (!row) return null;

  try {
    return JSON.parse(row.transcript) as StoredTranscript;
  } catch {
    return { answers: [] };
  }
}

/** Turn the tapped answers into the prose the model actually reads. */
function toTranscript(stored: StoredTranscript): TranscriptTurn[] {
  const lines = stored.answers.map((entry) => `Q: ${entry.prompt}\nA: ${entry.answer}`);

  return [{ role: "user", content: lines.join("\n\n") }];
}

export async function onboardingTurn({
  db,
  userId,
  client,
  now,
  sessionId,
  answer,
}: {
  db: D1Database;
  userId: string;
  client: ProfileClient;
  now: Date;
  sessionId?: string;
  answer?: string;
}): Promise<TurnResult> {
  // --- Starting a new interview ---
  if (!sessionId) {
    if ((await countSessionsToday(db, userId, now)) >= MAX_SESSIONS_PER_DAY) {
      return { ok: false, reason: "rate_limited" };
    }

    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO qa_sessions (id, user_id, type, transcript, tokens_used) VALUES (?, ?, 'onboarding', ?, 0)",
      )
      .bind(id, userId, JSON.stringify({ answers: [] } satisfies StoredTranscript))
      .run();

    return {
      ok: true,
      done: false,
      sessionId: id,
      question: QUESTIONS[0],
      index: 0,
      total: QUESTIONS.length,
    };
  }

  // --- Continuing one ---
  const stored = await loadSession(db, userId, sessionId);
  if (!stored) return { ok: false, reason: "not_found" };
  if (stored.complete) return { ok: false, reason: "already_complete" };

  const answered = stored.answers.length;
  const current = QUESTIONS[answered];

  if (current && answer !== undefined) {
    stored.answers.push({ question_id: current.id, prompt: current.prompt, answer });
  }

  const nextIndex = stored.answers.length;

  if (nextIndex < QUESTIONS.length) {
    await db
      .prepare("UPDATE qa_sessions SET transcript = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify(stored), sessionId, userId)
      .run();

    return {
      ok: true,
      done: false,
      sessionId,
      question: QUESTIONS[nextIndex],
      index: nextIndex,
      total: QUESTIONS.length,
    };
  }

  // --- Every question answered: the one and only model call ---
  const { profile, tokensUsed, usedFallback } = await extractProfile({
    client,
    transcript: toTranscript(stored),
  });

  stored.complete = true;

  await db.batch([
    db
      .prepare("UPDATE qa_sessions SET transcript = ?, tokens_used = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify(stored), tokensUsed, sessionId, userId),
    // A re-run of onboarding replaces the profile rather than adding a second.
    db
      .prepare(
        `INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .bind(userId, JSON.stringify(profile)),
  ]);

  return { ok: true, done: true, sessionId, profile, usedFallback };
}
