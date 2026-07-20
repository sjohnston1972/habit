// Tuning data for the suggestion engine (CLAUDE.md §6), alone in one file so
// tuning never touches scoring logic. See suggestion_log for the data this
// will eventually be tuned against (CLAUDE.md §6/§14 Phase 3).
export const WEIGHTS = {
  categoryFit: 3.0,
  timeMatch: 2.0,
  capacityFit: 1.5,
  balanceBonus: 1.0,
  novelty: 1.0,
  progression: 0.5,
  declinedPenalty: 2.0,
} as const;
