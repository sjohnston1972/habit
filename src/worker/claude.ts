import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PROFILE } from "../shared/default-profile";
import { CATEGORIES } from "../shared/habit";
import { ProfileSchema, type Profile } from "../shared/profile";

/**
 * The AI half of the control plane (CLAUDE.md §5). Runs Worker-side only — the
 * API key is a Worker secret and never reaches the browser.
 *
 * The model's job ends with producing a JSON profile. The shape is enforced
 * twice over: API-side by structured outputs, and again by Zod on receipt. If
 * both attempts fail we hand back `DEFAULT_PROFILE`, so a bad day from the
 * model degrades to a working app rather than a broken one.
 */

/** CLAUDE.md §5: a small, cheap model with a tight prompt and a hard token budget. */
export const MODEL = "claude-haiku-4-5";

const MAX_TOKENS = 1024;

export const SYSTEM_PROMPT = `You are the onboarding interviewer for a habit-building app.

Your job is to turn what the user has told you into a structured profile.

Rules:
- category_scores: 0-100 per category. Higher means the user wants MORE focus
  there. Use 50 when they have said nothing relevant — do not guess wildly.
- capacity_minutes_per_day: realistic minutes they can spend, total, per day.
- preferred_times: only times they actually indicated.
- identity_goals: short phrases in the user's own framing ("healthier",
  "more organised"), not outcomes with numbers.
- avoid_tags: activities they said they dislike or cannot do.
- notes: one short line of context that would change which habits suit them.

Be conservative. A profile that says "I don't know" via 50s is more useful than
one that invents preferences the user never expressed.`;

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
}

/** The one call shape this module needs — small enough to fake in tests without mocking the SDK. */
export interface ProfileClient {
  create(input: {
    system: string;
    transcript: TranscriptTurn[];
    schema: Record<string, unknown>;
  }): Promise<{ profile: unknown; tokens: number }>;
}

/**
 * `ProfileSchema`'s JSON-Schema form, hand-built rather than derived.
 *
 * Structured outputs reject several JSON Schema constructs that generic Zod
 * converters emit, and the schema is small enough that writing it out is
 * cheaper than debugging a converter. `test/profile-schema.test.ts` asserts it
 * stays in sync with `CATEGORIES`.
 */
export function profileJsonSchema() {
  const categoryProperties = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      { type: "integer", description: `0-100 desire for more focus on ${category}` },
    ]),
  );

  return {
    type: "object" as const,
    properties: {
      category_scores: {
        type: "object",
        properties: categoryProperties,
        required: [...CATEGORIES],
        additionalProperties: false,
      },
      capacity_minutes_per_day: { type: "integer" },
      preferred_times: {
        type: "array",
        items: { type: "string", enum: ["morning", "midday", "evening"] },
      },
      identity_goals: { type: "array", items: { type: "string" } },
      avoid_tags: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
    required: [
      "category_scores",
      "capacity_minutes_per_day",
      "preferred_times",
      "identity_goals",
      "avoid_tags",
      "notes",
    ],
    additionalProperties: false,
  };
}

/** The real client. `claude-haiku-4-5` takes no `effort` and needs no thinking here. */
export function createClaudeClient(apiKey: string): ProfileClient {
  const anthropic = new Anthropic({ apiKey });

  return {
    async create({ system, transcript, schema }) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: transcript.map((turn) => ({ role: turn.role, content: turn.content })),
        output_config: { format: { type: "json_schema", schema } },
      });

      const text = response.content.find((block) => block.type === "text");
      const tokens = response.usage.input_tokens + response.usage.output_tokens;

      return { profile: text ? JSON.parse(text.text) : null, tokens };
    },
  };
}

export interface ExtractResult {
  profile: Profile;
  tokensUsed: number;
  usedFallback: boolean;
}

/**
 * Ask the model for a profile, validate it, retry once, then fall back.
 *
 * Token usage is summed across *every* attempt, including the failed ones —
 * a retry costs real money and `qa_sessions` should say so.
 */
export async function extractProfile({
  client,
  transcript,
}: {
  client: ProfileClient;
  transcript: TranscriptTurn[];
}): Promise<ExtractResult> {
  const schema = profileJsonSchema();
  let tokensUsed = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { profile, tokens } = await client.create({
        system: SYSTEM_PROMPT,
        transcript,
        schema,
      });
      tokensUsed += tokens;

      const parsed = ProfileSchema.safeParse(profile);
      if (parsed.success) {
        return { profile: parsed.data, tokensUsed, usedFallback: false };
      }
    } catch {
      // Network failure or unparseable body — treated the same as a bad shape.
    }
  }

  return { profile: DEFAULT_PROFILE, tokensUsed, usedFallback: true };
}
