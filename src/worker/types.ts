export type Bindings = {
  DB: D1Database;
  /** Worker secret. Empty string when unset — callers must check before use. */
  ANTHROPIC_API_KEY: string;
};

export type Variables = {
  userId: string;
};
