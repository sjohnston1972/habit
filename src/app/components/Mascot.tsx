export type MascotMood = "idle" | "happy" | "celebrating" | "sad";

const MOOD_LABEL: Record<MascotMood, string> = {
  idle: "Otter waiting",
  happy: "Otter happy",
  celebrating: "Otter celebrating",
  sad: "Otter having a rough day",
};

// Real illustration swaps in behind this component later — the otter is
// emoji-backed for now (PLAN.md decisions: no generated art this run).
const MOOD_ANIMATION_CLASS: Record<MascotMood, string> = {
  idle: "",
  happy: "motion-safe:animate-bounce",
  celebrating: "motion-safe:animate-spin",
  sad: "",
};

export function Mascot({ mood = "idle" }: { mood?: MascotMood }) {
  return (
    <span
      role="img"
      aria-label={MOOD_LABEL[mood]}
      className={`inline-block text-6xl ${MOOD_ANIMATION_CLASS[mood]}`}
    >
      🦦
    </span>
  );
}
