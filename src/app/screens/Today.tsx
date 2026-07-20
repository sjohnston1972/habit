import { useCallback, useEffect, useState } from "react";
import { PRODUCT } from "@shared/branding";
import { HabitCard, type HabitCardHabit } from "../components/HabitCard";
import { Mascot, type MascotMood } from "../components/Mascot";
import { SuggestionCard, type SuggestionHabit } from "../components/SuggestionCard";

export interface TodayHabit extends HabitCardHabit {
  habit_id: string;
}

interface Suggestion {
  habit: SuggestionHabit;
  score: number;
}

type LoadState = "loading" | "ready" | "error";

export function Today() {
  const [habits, setHabits] = useState<TodayHabit[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    try {
      const [todayRes, suggestionsRes] = await Promise.all([
        fetch("/api/today"),
        fetch("/api/suggestions"),
      ]);

      if (!todayRes.ok || !suggestionsRes.ok) {
        setState("error");
        return;
      }

      const todayBody = (await todayRes.json()) as { habits: TodayHabit[] };
      const suggestionsBody = (await suggestionsRes.json()) as { suggestions: Suggestion[] };

      setHabits(todayBody.habits ?? []);
      setSuggestions(suggestionsBody.suggestions ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleHabit = useCallback(
    async (userHabitId: string) => {
      // Decide from the state we can see now. Reading the answer out of a
      // setState updater would be a race: React may not have run it yet.
      const target = habits.find((habit) => habit.user_habit_id === userHabitId);
      if (!target) return;

      const nowCompleted = !target.completed;

      // Optimistic: the tap should feel instant even on a slow connection.
      setHabits((current) =>
        current.map((habit) =>
          habit.user_habit_id === userHabitId
            ? {
                ...habit,
                completed: nowCompleted,
                streak: {
                  ...habit.streak,
                  current: Math.max(0, habit.streak.current + (nowCompleted ? 1 : -1)),
                },
              }
            : habit,
        ),
      );

      try {
        await fetch(`/api/user-habits/${userHabitId}/checkin`, {
          method: nowCompleted ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: nowCompleted ? JSON.stringify({}) : undefined,
        });
      } catch {
        // Step 13 replaces this with the offline queue.
      }
    },
    [habits],
  );

  const adopt = useCallback(
    async (habitId: string) => {
      setSuggestions((current) => current.filter((s) => s.habit.id !== habitId));

      try {
        await fetch(`/api/habits/${habitId}/adopt`, { method: "POST" });
        await load();
      } catch {
        // Leave the optimistic removal in place; the next load reconciles.
      }
    },
    [load],
  );

  const dismiss = useCallback(async (habitId: string) => {
    setSuggestions((current) => current.filter((s) => s.habit.id !== habitId));

    try {
      await fetch(`/api/habits/${habitId}/dismiss`, { method: "POST" });
    } catch {
      // A dismissal that fails to record is a small loss; don't interrupt the user.
    }
  }, []);

  const bestStreak = habits.reduce((max, habit) => Math.max(max, habit.streak.current), 0);
  const doneToday = habits.filter((habit) => habit.completed).length;
  const allDone = habits.length > 0 && doneToday === habits.length;

  const mood: MascotMood = state === "error" ? "sad" : allDone ? "celebrating" : "idle";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 bg-[#FFFDF7] px-5 py-8 font-body">
      <header className="flex items-center gap-4">
        <Mascot mood={mood} />
        <div>
          <h1 className="font-display text-2xl text-[#2F6F5E]">{PRODUCT}</h1>
          {habits.length > 0 ? (
            <p className="text-sm text-slate-600">
              <span aria-hidden="true">🔥</span> Best streak going: {bestStreak} day
              {bestStreak === 1 ? "" : "s"} · {doneToday} of {habits.length} done today
            </p>
          ) : (
            <p className="text-sm text-slate-600">Let's find your first habit.</p>
          )}
        </div>
      </header>

      {state === "error" && (
        <p className="rounded-3xl bg-amber-50 p-4 text-sm text-amber-900">
          We can't reach your habits right now. They're safe — try again in a moment.
        </p>
      )}

      {state !== "error" && (
        <>
          <section className="flex flex-col gap-3" aria-label="Today's habits">
            {habits.map((habit) => (
              <HabitCard key={habit.user_habit_id} habit={habit} onToggle={toggleHabit} />
            ))}

            {state === "ready" && habits.length === 0 && (
              <p className="rounded-3xl bg-white/70 p-4 text-sm text-slate-600">
                No habits yet — pick one to get started.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-label="Suggested for you">
            <h2 className="font-display text-lg text-slate-800">Suggested for you</h2>

            {suggestions.map((suggestion, index) => (
              <SuggestionCard
                key={suggestion.habit.id}
                habit={suggestion.habit}
                // Cards deal out like a hand being played (CLAUDE.md §10).
                dealIndex={index}
                onAdopt={adopt}
                onDismiss={dismiss}
              />
            ))}

            {state === "ready" && suggestions.length === 0 && (
              <p className="rounded-3xl bg-white/70 p-4 text-sm text-slate-600">
                That's today's suggestions done — fresh ones tomorrow.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
