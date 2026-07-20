import { describe, expect, it } from "vitest";
import { bucketFor, localDateFor } from "../src/shared/time-of-day";

/** A Date at a given UTC wall-clock time, so tests never depend on the runner's zone. */
function utc(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
}

describe("bucketFor", () => {
  // Spec: 05–10 morning, 11–16 midday, 17–21 evening, 22–04 evening.
  const expected: Record<number, "morning" | "midday" | "evening"> = {
    0: "evening",
    1: "evening",
    2: "evening",
    3: "evening",
    4: "evening",
    5: "morning",
    6: "morning",
    7: "morning",
    8: "morning",
    9: "morning",
    10: "morning",
    11: "midday",
    12: "midday",
    13: "midday",
    14: "midday",
    15: "midday",
    16: "midday",
    17: "evening",
    18: "evening",
    19: "evening",
    20: "evening",
    21: "evening",
    22: "evening",
    23: "evening",
  };

  for (const [hour, bucket] of Object.entries(expected)) {
    it(`maps local hour ${hour} to ${bucket}`, () => {
      expect(bucketFor(utc(2026, 7, 15, Number(hour)), "UTC")).toBe(bucket);
    });
  }

  it("uses the user's zone, not UTC, east of UTC", () => {
    // 18:00Z on the 15th is 06:00 on the 16th in Auckland (UTC+12 in July).
    expect(bucketFor(utc(2026, 7, 15, 18), "Pacific/Auckland")).toBe("morning");
  });

  it("uses the user's zone, not UTC, west of UTC", () => {
    // 06:00Z on the 15th is 23:00 on the 14th in Los Angeles (UTC-7 in July).
    expect(bucketFor(utc(2026, 7, 15, 6), "America/Los_Angeles")).toBe("evening");
  });

  it("puts the same instant in different buckets for different zones", () => {
    const instant = utc(2026, 7, 15, 18);

    expect(bucketFor(instant, "Pacific/Auckland")).toBe("morning");
    expect(bucketFor(instant, "America/Los_Angeles")).toBe("midday");
    expect(bucketFor(instant, "UTC")).toBe("evening");
  });
});

describe("localDateFor", () => {
  it("returns YYYY-MM-DD in the user's zone", () => {
    expect(localDateFor(utc(2026, 7, 15, 12), "UTC")).toBe("2026-07-15");
  });

  it("rolls forward when the local date is ahead of the UTC date", () => {
    expect(localDateFor(utc(2026, 7, 15, 18), "Pacific/Auckland")).toBe("2026-07-16");
  });

  it("rolls back when the local date is behind the UTC date", () => {
    expect(localDateFor(utc(2026, 7, 15, 6), "America/Los_Angeles")).toBe("2026-07-14");
  });

  it("zero-pads single-digit months and days", () => {
    expect(localDateFor(utc(2026, 3, 5, 12), "UTC")).toBe("2026-03-05");
  });
});
