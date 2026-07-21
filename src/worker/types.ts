export type Bindings = {
  DB: D1Database;
  /** Worker secret. Empty string when unset — callers must check before use. */
  ANTHROPIC_API_KEY: string;
  /** Resend API key (Worker secret). Empty when unset → fall back to console logging. */
  RESEND_API_KEY: string;
  /** Optional override for the magic-link sender address. Empty → use the default. */
  EMAIL_FROM: string;
};

export type Variables = {
  userId: string;
};
