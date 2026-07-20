import confetti from "canvas-confetti";
import type { CheckinOutcome } from "@shared/streaks";

/**
 * The satisfying half of the habit loop (CLAUDE.md §2.5, §10): confetti and a
 * short buzz the instant a habit is ticked off.
 *
 * Every effect here is opt-out by default. A user who has told their phone they
 * want less movement gets none of it — not a smaller version, none.
 */

export function prefersReducedMotion(): boolean {
  // Some embedded browsers lack matchMedia entirely; assume motion is welcome.
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const BURST: Partial<Record<CheckinOutcome, { particleCount: number; spread: number }>> = {
  incremented: { particleCount: 60, spread: 60 },
  // Saving a streak is the better story, so it gets the bigger burst.
  repaired: { particleCount: 140, spread: 100 },
  reset: { particleCount: 40, spread: 50 },
};

const BUZZ: Partial<Record<CheckinOutcome, number | number[]>> = {
  incremented: 12,
  repaired: [10, 40, 20],
  reset: 8,
};

export function celebrateCheckoff(outcome: CheckinOutcome): void {
  if (prefersReducedMotion()) return;

  const burst = BURST[outcome];
  if (!burst) return;

  confetti({ ...burst, origin: { y: 0.7 }, disableForReducedMotion: true });

  const pattern = BUZZ[outcome];
  if (pattern !== undefined && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

/** Warm, never guilt-tripping (CLAUDE.md §10). */
export const OUTCOME_MESSAGE: Partial<Record<CheckinOutcome, string>> = {
  repaired: "Phew — saved it! Your streak lives on.",
  reset: "Fresh start! Day one of the next streak.",
};
