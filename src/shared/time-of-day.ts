/**
 * Timezone-aware day arithmetic. "Today" and the time-of-day bucket must be
 * computed in the user's stored IANA zone (CLAUDE.md §7), never the server's —
 * a Worker has no meaningful local time of its own.
 */

/** The buckets a habit's `time_of_day` can be matched against when scoring. */
export type Bucket = "morning" | "midday" | "evening";

/** Local hour, 0–23, in the given IANA zone. */
function localHour(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(date);

  // "24" is how some ICU builds render midnight under hour12: false.
  return Number(hour) % 24;
}

/**
 * Which part of the user's day it is.
 *
 * 05–10 morning · 11–16 midday · 17–21 evening · 22–04 evening. Late night
 * folds into evening rather than getting its own bucket: habits written for
 * "evening" are the ones that still make sense at 1am, and a fourth bucket
 * would leave those hours with nothing to match.
 */
export function bucketFor(date: Date, timezone: string): Bucket {
  const hour = localHour(date, timezone);

  if (hour >= 5 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 16) return "midday";
  return "evening";
}

/** The user's local calendar date as `YYYY-MM-DD` — the key check-ins and streaks are bucketed by. */
export function localDateFor(date: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, zero-padded, which is exactly the shape we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
