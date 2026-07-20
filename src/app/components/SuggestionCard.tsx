import { categoryToken } from "../category-colors";

export interface SuggestionHabit {
  id: string;
  title: string;
  category: string;
  tiny_version: string;
  standard_version: string;
  identity_statement: string;
  duration_minutes: number;
}

const ACCENT_BAR: Record<string, string> = {
  exercise: "bg-category-exercise",
  nutrition: "bg-category-nutrition",
  sleep: "bg-category-sleep",
  mindfulness: "bg-category-mindfulness",
  home: "bg-category-home",
  money: "bg-category-money",
  relationships: "bg-category-relationships",
  work: "bg-category-work",
  learning: "bg-category-learning",
  digital: "bg-category-digital",
  outdoors: "bg-category-outdoors",
  selfcare: "bg-category-selfcare",
};

/** Stagger so the three cards deal out rather than appearing all at once. */
const DEAL_DELAY = ["", "motion-safe:[animation-delay:80ms]", "motion-safe:[animation-delay:160ms]"];

export function SuggestionCard({
  habit,
  dealIndex = 0,
  onAdopt,
  onDismiss,
}: {
  habit: SuggestionHabit;
  dealIndex?: number;
  onAdopt: (habitId: string) => void;
  onDismiss: (habitId: string) => void;
}) {
  const bar = ACCENT_BAR[categoryToken(habit.category)] ?? ACCENT_BAR.digital;

  return (
    <article
      className={[
        "overflow-hidden rounded-3xl bg-white shadow-[0_6px_0_rgba(0,0,0,0.08)]",
        "motion-safe:animate-[fadeInUp_320ms_ease-out_both]",
        DEAL_DELAY[dealIndex] ?? "",
      ].join(" ")}
    >
      <div className={`h-2 w-full ${bar}`} aria-hidden="true" />

      <div className="flex flex-col gap-2 p-4">
        <h3 className="font-display text-lg font-bold text-slate-900">{habit.title}</h3>
        {/* New adopters always start tiny (CLAUDE.md §2.1), so that's what we promise. */}
        <p className="text-sm text-slate-600">Start tiny: {habit.tiny_version}</p>
        <p className="text-xs italic text-slate-500">{habit.identity_statement}</p>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onAdopt(habit.id)}
            className="flex-1 rounded-full bg-[#2F6F5E] px-4 py-3 font-display text-white motion-safe:transition-transform motion-safe:active:scale-95"
          >
            Adopt
          </button>
          <button
            type="button"
            onClick={() => onDismiss(habit.id)}
            className="rounded-full border-2 border-slate-200 px-4 py-3 font-display text-slate-500 motion-safe:transition-transform motion-safe:active:scale-95"
          >
            Not today
          </button>
        </div>
      </div>
    </article>
  );
}
