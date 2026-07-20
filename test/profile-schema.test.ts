import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/shared/habit";
import { DEFAULT_PROFILE } from "../src/shared/default-profile";
import { ProfileSchema } from "../src/shared/profile";
import { extractProfile, profileJsonSchema } from "../src/worker/claude";

function validProfileJson() {
  return {
    category_scores: Object.fromEntries(CATEGORIES.map((c) => [c, 50])),
    capacity_minutes_per_day: 20,
    preferred_times: ["morning"],
    identity_goals: ["healthier"],
    avoid_tags: ["running"],
    notes: "shift worker",
  };
}

describe("profileJsonSchema", () => {
  it("is a JSON Schema object the API can enforce", () => {
    const schema = profileJsonSchema();

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toContain("category_scores");
    expect(Object.keys(schema.properties)).toContain("capacity_minutes_per_day");
  });

  it("names every one of the 12 categories, so the model cannot invent one", () => {
    const schema = profileJsonSchema();
    const categoryProps = schema.properties.category_scores.properties;

    expect(Object.keys(categoryProps).sort()).toEqual([...CATEGORIES].sort());
  });
});

describe("extractProfile — offline validation", () => {
  it("accepts a well-formed profile", async () => {
    const result = await extractProfile({
      client: { create: async () => ({ profile: validProfileJson(), tokens: 100 }) },
      transcript: [],
    });

    expect(result.usedFallback).toBe(false);
    expect(result.profile.capacity_minutes_per_day).toBe(20);
    expect(() => ProfileSchema.parse(result.profile)).not.toThrow();
  });

  it("retries once when the first response is malformed", async () => {
    let calls = 0;
    const result = await extractProfile({
      client: {
        create: async () => {
          calls += 1;
          if (calls === 1) return { profile: { category_scores: "nonsense" }, tokens: 50 };
          return { profile: validProfileJson(), tokens: 60 };
        },
      },
      transcript: [],
    });

    expect(calls).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.profile.capacity_minutes_per_day).toBe(20);
  });

  it("falls back to the default profile when both attempts are malformed", async () => {
    let calls = 0;
    const result = await extractProfile({
      client: {
        create: async () => {
          calls += 1;
          return { profile: { nope: true }, tokens: 10 };
        },
      },
      transcript: [],
    });

    expect(calls).toBe(2);
    expect(result.usedFallback).toBe(true);
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });

  it("falls back rather than throwing when the call itself fails", async () => {
    const result = await extractProfile({
      client: {
        create: async () => {
          throw new Error("network down");
        },
      },
      transcript: [],
    });

    expect(result.usedFallback).toBe(true);
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });

  it("rejects a profile with an unknown category — the schema is strict", async () => {
    const bad = validProfileJson();
    (bad.category_scores as Record<string, number>)["Underwater Basket Weaving"] = 70;

    const result = await extractProfile({
      client: { create: async () => ({ profile: bad, tokens: 10 }) },
      transcript: [],
    });

    expect(result.usedFallback).toBe(true);
  });

  it("rejects an out-of-range category score", async () => {
    const bad = validProfileJson();
    bad.category_scores["Sleep & Rest"] = 500;

    const result = await extractProfile({
      client: { create: async () => ({ profile: bad, tokens: 10 }) },
      transcript: [],
    });

    expect(result.usedFallback).toBe(true);
  });

  it("reports the tokens spent across every attempt, so cost stays observable", async () => {
    let calls = 0;
    const result = await extractProfile({
      client: {
        create: async () => {
          calls += 1;
          if (calls === 1) return { profile: { bad: true }, tokens: 40 };
          return { profile: validProfileJson(), tokens: 60 };
        },
      },
      transcript: [],
    });

    expect(result.tokensUsed).toBe(100);
  });
});

// One live call, per the plan: proves the real API honours the schema.
describe.skipIf(!env.ANTHROPIC_API_KEY)("extractProfile — live API", () => {
  it("returns a ProfileSchema-valid object from a real call", async () => {
    const { createClaudeClient } = await import("../src/worker/claude");

    const result = await extractProfile({
      client: createClaudeClient(env.ANTHROPIC_API_KEY),
      transcript: [
        {
          role: "user",
          content:
            "I work shifts so my mornings vary. I'd like to move more and sleep better. " +
            "I have about 20 minutes a day. Please don't suggest running.",
        },
      ],
    });

    expect(result.usedFallback).toBe(false);
    expect(() => ProfileSchema.parse(result.profile)).not.toThrow();
    expect(result.tokensUsed).toBeGreaterThan(0);
  }, 60_000);
});
