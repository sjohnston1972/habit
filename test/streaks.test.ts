import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { applyCheckin, type StreakState } from "../src/shared/streaks";

const FRESH: StreakState = {
  current: 0,
  best: 0,
  last_completed_date: null,
  repair_available: true,
  consecutive_since_repair: 0,
};

function streak(overrides: Partial<StreakState>): StreakState {
  return { ...FRESH, ...overrides };
}

describe("applyCheckin — the never-miss-twice rule", () => {
  it("starts a streak at 1 when the habit has never been completed", () => {
    const { streak: next, outcome } = applyCheckin(FRESH, "2026-07-15");

    expect(outcome).toBe("incremented");
    expect(next.current).toBe(1);
    expect(next.last_completed_date).toBe("2026-07-15");
  });

  it("is a no-op when the habit was already completed today", () => {
    const before = streak({ current: 4, best: 9, last_completed_date: "2026-07-15" });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("noop");
    expect(next).toEqual(before);
  });

  it("increments when the habit was completed yesterday", () => {
    const before = streak({ current: 4, best: 9, last_completed_date: "2026-07-14" });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("incremented");
    expect(next.current).toBe(5);
  });

  it("repairs a single missed day when a repair is available", () => {
    const before = streak({
      current: 4,
      best: 9,
      last_completed_date: "2026-07-13",
      repair_available: true,
    });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("repaired");
    expect(next.current).toBe(5);
    expect(next.repair_available).toBe(false);
  });

  it("resets after a single missed day when no repair is available", () => {
    const before = streak({
      current: 4,
      best: 9,
      last_completed_date: "2026-07-13",
      repair_available: false,
    });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("reset");
    expect(next.current).toBe(1);
  });

  it("resets after two or more missed days even with a repair available", () => {
    const before = streak({
      current: 20,
      best: 20,
      last_completed_date: "2026-07-11",
      repair_available: true,
    });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("reset");
    expect(next.current).toBe(1);
  });

  it("hands back the repair on a reset — a fresh start starts fresh", () => {
    const before = streak({
      current: 4,
      last_completed_date: "2026-07-01",
      repair_available: false,
      consecutive_since_repair: 3,
    });

    const { streak: next } = applyCheckin(before, "2026-07-15");

    expect(next.repair_available).toBe(true);
    expect(next.consecutive_since_repair).toBe(0);
  });
});

describe("applyCheckin — best streak", () => {
  it("raises best when current overtakes it", () => {
    const before = streak({ current: 9, best: 9, last_completed_date: "2026-07-14" });

    const { streak: next } = applyCheckin(before, "2026-07-15");

    expect(next.current).toBe(10);
    expect(next.best).toBe(10);
  });

  it("leaves best alone when current is still below it", () => {
    const before = streak({ current: 2, best: 30, last_completed_date: "2026-07-14" });

    const { streak: next } = applyCheckin(before, "2026-07-15");

    expect(next.best).toBe(30);
  });

  it("keeps best through a reset — a broken streak never erases the record", () => {
    const before = streak({
      current: 30,
      best: 30,
      last_completed_date: "2026-06-01",
      repair_available: false,
    });

    const { streak: next } = applyCheckin(before, "2026-07-15");

    expect(next.current).toBe(1);
    expect(next.best).toBe(30);
  });
});

describe("applyCheckin — repair regeneration", () => {
  it("counts consecutive days once a repair has been spent", () => {
    const before = streak({
      current: 5,
      last_completed_date: "2026-07-14",
      repair_available: false,
      consecutive_since_repair: 2,
    });

    const { streak: next } = applyCheckin(before, "2026-07-15");

    expect(next.consecutive_since_repair).toBe(3);
    expect(next.repair_available).toBe(false);
  });

  it("regenerates the repair at exactly 7 consecutive days, not before", () => {
    const sixDaysIn = streak({
      current: 6,
      last_completed_date: "2026-07-14",
      repair_available: false,
      consecutive_since_repair: 5,
    });

    const atSix = applyCheckin(sixDaysIn, "2026-07-15");
    expect(atSix.streak.consecutive_since_repair).toBe(6);
    expect(atSix.streak.repair_available).toBe(false);

    const atSeven = applyCheckin(atSix.streak, "2026-07-16");
    expect(atSeven.streak.repair_available).toBe(true);
    expect(atSeven.streak.consecutive_since_repair).toBe(0);
  });

  it("starts the regeneration count from zero on the day a repair is consumed", () => {
    const before = streak({
      current: 4,
      last_completed_date: "2026-07-13",
      repair_available: true,
      consecutive_since_repair: 4,
    });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-15");

    expect(outcome).toBe("repaired");
    expect(next.consecutive_since_repair).toBe(0);
  });
});

describe("applyCheckin — out-of-order replay", () => {
  it("ignores a check-in dated before the last completed day", () => {
    // An offline check-off made on Tuesday can flush after Wednesday's has
    // already been recorded. Replaying it must not corrupt the streak.
    const before = streak({ current: 5, best: 5, last_completed_date: "2026-07-15" });

    const { streak: next, outcome } = applyCheckin(before, "2026-07-14");

    expect(outcome).toBe("noop");
    expect(next).toEqual(before);
  });
});

describe("applyCheckin — purity", () => {
  it("does not mutate the streak it is given", () => {
    const before = streak({ current: 4, best: 9, last_completed_date: "2026-07-14" });
    const snapshot = structuredClone(before);

    applyCheckin(before, "2026-07-15");

    expect(before).toEqual(snapshot);
  });
});

describe("streaks schema", () => {
  it("has the consecutive_since_repair column", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(streaks)").all<{ name: string }>();

    expect(results.map((row) => row.name)).toContain("consecutive_since_repair");
  });
});
