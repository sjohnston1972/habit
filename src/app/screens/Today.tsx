import { useCallback, useEffect, useState } from "react";
import { PRODUCT } from "@shared/branding";
import type { CheckinOutcome } from "@shared/streaks";
import { localDateFor } from "@shared/time-of-day";
import { celebrateCheckoff, OUTCOME_MESSAGE } from "../feedback";
import { dequeue, enqueue, flush, pending } from "../offline-queue";
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
  const [message, setMessage] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  // The device's own zone. The server stores the user's zone too, but a
  // check-off should be dated where the user actually was when they tapped.
  const localDate = localDateFor(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

  /** Try to send everything queued, and fold the server's verdict back in. */
  const syncQueue = useCallback(async () => {
    const { flushed } = await flush(fetch);

    for (const item of flushed) {
      if (item.outcome) {
        celebrateCheckoff(item.outcome as CheckinOutcome);
        setMessage(OUTCOME_MESSAGE[item.outcome as CheckinOutcome] ?? null);
      }
      // The server is the authority on what the streak actually became — a
      // repair or a reset lands somewhere the optimistic guess didn't.
      if (item.streak) {
        setHabits((current) =>
          current.map((habit) =>
            habit.user_habit_id === item.user_habit_id
              ? { ...habit, streak: item.streak! }
              : habit,
          ),
        );
      }
    }

    const stillWaiting = await pending();
    setPendingIds(stillWaiting.map((item) => item.user_habit_id));
  }, []);

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
    // Anything left over from a previous visit goes out as soon as we open.
    void syncQueue();
  }, [load, syncQueue]);

  useEffect(() => {
    const onOnline = () => {
      void syncQueue();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncQueue]);

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

      if (!nowCompleted) {
        // Undo: drop it from the queue if it never left, then tell the server.
        await dequeue({ user_habit_id: userHabitId, local_date: localDate });
        setPendingIds((current) => current.filter((id) => id !== userHabitId));

        try {
          await fetch(`/api/user-habits/${userHabitId}/checkin`, { method: "DELETE" });
        } catch {
          // The undo will be reconciled by the next load.
        }
        return;
      }

      // Queue first, then try to send. If the tab dies between the tap and the
      // request, the check-off is already on disk rather than lost.
      await enqueue({ user_habit_id: userHabitId, local_date: localDate });
      setPendingIds((current) => [...new Set([...current, userHabitId])]);

      await syncQueue();
    },
    [habits, syncQueue],
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

      {message && (
        <p
          role="status"
          className="rounded-3xl bg-[#2F6F5E]/10 p-4 text-center font-display text-[#2F6F5E] motion-safe:animate-[fadeInUp_320ms_ease-out_both]"
        >
          {message}
        </p>
      )}

      {state === "error" && (
        <p className="rounded-3xl bg-amber-50 p-4 text-sm text-amber-900">
          We can't reach your habits right now. They're safe — try again in a moment.
        </p>
      )}

      {state !== "error" && (
        <>
          <section className="flex flex-col gap-3" aria-label="Today's habits">
            {habits.map((habit) => (
              <HabitCard
                key={habit.user_habit_id}
                habit={habit}
                onToggle={toggleHabit}
                pending={pendingIds.includes(habit.user_habit_id)}
              />
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
