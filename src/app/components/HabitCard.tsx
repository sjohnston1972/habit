import { categoryToken } from "../category-colors";

export interface HabitCardHabit {
  user_habit_id: string;
  title: string;
  category: string;
  level: string;
  tiny_version: string;
  standard_version: string;
  identity_statement: string;
  completed: boolean;
  streak: { current: number; best: number };
}

/**
 * Full class strings, not interpolated fragments: Tailwind scans source text
 * for class names, so `bg-category-${token}` would be compiled away to nothing.
 */
const ACCENT: Record<string, { border: string; chip: string; ring: string }> = {
  exercise: { border: "border-category-exercise", chip: "bg-category-exercise", ring: "ring-category-exercise" },
  nutrition: { border: "border-category-nutrition", chip: "bg-category-nutrition", ring: "ring-category-nutrition" },
  sleep: { border: "border-category-sleep", chip: "bg-category-sleep", ring: "ring-category-sleep" },
  mindfulness: { border: "border-category-mindfulness", chip: "bg-category-mindfulness", ring: "ring-category-mindfulness" },
  home: { border: "border-category-home", chip: "bg-category-home", ring: "ring-category-home" },
  money: { border: "border-category-money", chip: "bg-category-money", ring: "ring-category-money" },
  relationships: { border: "border-category-relationships", chip: "bg-category-relationships", ring: "ring-category-relationships" },
  work: { border: "border-category-work", chip: "bg-category-work", ring: "ring-category-work" },
  learning: { border: "border-category-learning", chip: "bg-category-learning", ring: "ring-category-learning" },
  digital: { border: "border-category-digital", chip: "bg-category-digital", ring: "ring-category-digital" },
  outdoors: { border: "border-category-outdoors", chip: "bg-category-outdoors", ring: "ring-category-outdoors" },
  selfcare: { border: "border-category-selfcare", chip: "bg-category-selfcare", ring: "ring-category-selfcare" },
};

function versionFor(habit: HabitCardHabit): string {
  return habit.level === "tiny" ? habit.tiny_version : habit.standard_version;
}

export function HabitCard({
  habit,
  onToggle,
  pending = false,
}: {
  habit: HabitCardHabit;
  onToggle: (userHabitId: string) => void;
  pending?: boolean;
}) {
  const accent = ACCENT[categoryToken(habit.category)] ?? ACCENT.digital;

  return (
    <button
      type="button"
      aria-pressed={habit.completed}
      onClick={() => onToggle(habit.user_habit_id)}
      className={[
        "w-full text-left",
        // Chunky, sticker-like, and a comfortably large tap target (CLAUDE.md §10).
        "min-h-[5.5rem] rounded-3xl border-4 bg-white p-4",
        "shadow-[0_6px_0_rgba(0,0,0,0.08)]",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2",
        // Squash-and-stretch on press, calm for anyone who asked their phone for less motion.
        "motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-95",
        accent.border,
        accent.ring,
        habit.completed ? "opacity-80" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={[
            "mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-white",
            habit.completed ? accent.chip : "bg-slate-200",
          ].join(" ")}
        >
          {habit.completed ? "✓" : ""}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-bold text-slate-900">{habit.title}</span>
          <span className="block text-sm text-slate-600">{versionFor(habit)}</span>
          <span className="mt-1 block text-xs italic text-slate-500">
            {habit.identity_statement}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-base font-bold text-slate-700">
            <span aria-hidden="true">🔥</span>
            <span className="sr-only">Current streak: </span>
            {habit.streak.current}
          </span>
          {pending ? (
            <span
              aria-label="Waiting to sync"
              title="Waiting to sync"
              className="text-xs text-slate-400"
            >
              ⏳
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}
