import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "../../src/app/screens/Today";

interface FetchRoutes {
  today?: unknown;
  suggestions?: unknown;
  onPost?: (url: string) => { status?: number; body?: unknown };
}

/** A fetch stand-in that answers the two GETs the screen makes on mount. */
function mockFetch(routes: FetchRoutes) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET" && url.includes("/api/today")) {
      return new Response(JSON.stringify({ habits: routes.today ?? [] }), { status: 200 });
    }
    if (method === "GET" && url.includes("/api/suggestions")) {
      return new Response(JSON.stringify({ suggestions: routes.suggestions ?? [] }), {
        status: 200,
      });
    }

    const result = routes.onPost?.(url) ?? {};
    return new Response(JSON.stringify(result.body ?? { ok: true }), {
      status: result.status ?? 200,
    });
  });
}

const ACTIVE_HABIT = {
  user_habit_id: "uh-1",
  habit_id: "h-1",
  title: "Walk around the block",
  category: "Exercise & Movement",
  level: "tiny",
  tiny_version: "Put your shoes on",
  standard_version: "Walk 15 minutes",
  identity_statement: "I'm someone who moves",
  completed: false,
  streak: { current: 3, best: 8, repair_available: true },
};

function suggestion(id: string, title: string) {
  return {
    habit: {
      id,
      title,
      category: "Learning & Growth",
      tiny_version: "One page",
      standard_version: "Fifteen minutes",
      identity_statement: "I'm someone who reads",
      time_of_day: "evening",
      duration_minutes: 15,
      difficulty: 1,
    },
    score: 5,
    breakdown: {},
  };
}

const THREE_SUGGESTIONS = [
  suggestion("h-2", "Read before bed"),
  suggestion("h-3", "Stretch after coffee"),
  suggestion("h-4", "Tidy one surface"),
];

describe("Today screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({}));
  });

  it("shows the user's active habits", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [ACTIVE_HABIT] }));

    render(<Today />);

    expect(await screen.findByText("Walk around the block")).toBeTruthy();
  });

  it("shows exactly three suggestions", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [], suggestions: THREE_SUGGESTIONS }));

    render(<Today />);

    expect(await screen.findByText("Read before bed")).toBeTruthy();
    expect(screen.getByText("Stretch after coffee")).toBeTruthy();
    expect(screen.getByText("Tidy one surface")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /adopt/i })).toHaveLength(3);
  });

  it("shows active habits and suggestions together", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [ACTIVE_HABIT], suggestions: THREE_SUGGESTIONS }));

    render(<Today />);

    expect(await screen.findByText("Walk around the block")).toBeTruthy();
    expect(screen.getByText("Read before bed")).toBeTruthy();
  });

  it("summarises the streak across active habits", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [ACTIVE_HABIT] }));

    render(<Today />);

    expect(await screen.findByText(/Best streak going: 3 days/)).toBeTruthy();
    expect(screen.getByText(/0 of 1 done today/)).toBeTruthy();
  });

  it("welcomes a user who has adopted nothing yet", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [], suggestions: THREE_SUGGESTIONS }));

    render(<Today />);

    expect(await screen.findByText(/pick one to get started/i)).toBeTruthy();
  });

  it("adopts a suggestion and moves it into today's habits", async () => {
    let todayHabits: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.includes("/api/today")) {
        return new Response(JSON.stringify({ habits: todayHabits }), { status: 200 });
      }
      if (method === "GET" && url.includes("/api/suggestions")) {
        return new Response(JSON.stringify({ suggestions: THREE_SUGGESTIONS }), { status: 200 });
      }
      if (url.includes("/adopt")) {
        todayHabits = [{ ...ACTIVE_HABIT, habit_id: "h-2", title: "Read before bed" }];
        return new Response(JSON.stringify({ user_habit_id: "uh-2" }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Today />);
    const adoptButtons = await screen.findAllByRole("button", { name: /adopt/i });
    await userEvent.click(adoptButtons[0]);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/api/habits/h-2/adopt")),
      ).toBe(true);
    });
  });

  it("removes a dismissed suggestion from the deck", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [], suggestions: THREE_SUGGESTIONS }));

    render(<Today />);
    const dismissButtons = await screen.findAllByRole("button", { name: /not today/i });
    await userEvent.click(dismissButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("Read before bed")).toBeNull();
    });
    expect(screen.getByText("Stretch after coffee")).toBeTruthy();
  });

  it("tells the user when the day's suggestions are all dealt with", async () => {
    vi.stubGlobal("fetch", mockFetch({ today: [ACTIVE_HABIT], suggestions: [] }));

    render(<Today />);

    expect(await screen.findByText(/that's today's suggestions done/i)).toBeTruthy();
  });

  it("checks a habit off when its card is tapped", async () => {
    const fetchMock = mockFetch({ today: [ACTIVE_HABIT] });
    vi.stubGlobal("fetch", fetchMock);

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/user-habits/uh-1/checkin") &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("shows a friendly message when the data cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    render(<Today />);

    expect(await screen.findByText(/can't reach/i)).toBeTruthy();
  });
});
