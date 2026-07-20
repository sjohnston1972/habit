import "fake-indexeddb/auto";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueue, pending } from "../../src/app/offline-queue";
import { Today } from "../../src/app/screens/Today";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

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

/** GETs always succeed; check-in POSTs succeed or fail on demand. */
function mockFetch({ checkinsFail }: { checkinsFail: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET" && url.includes("/api/today")) {
      return new Response(JSON.stringify({ habits: [ACTIVE_HABIT] }), { status: 200 });
    }
    if (method === "GET" && url.includes("/api/suggestions")) {
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    }
    if (url.includes("/checkin")) {
      if (checkinsFail) throw new Error("offline");
      return new Response(
        JSON.stringify({
          outcome: "incremented",
          streak: { current: 4, best: 8, repair_available: true },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
}

beforeEach(async () => {
  await clearQueue();
});

describe("offline check-off", () => {
  it("shows the habit as done immediately even with no connection", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    const card = await screen.findByRole("button", { name: /walk around the block/i });
    await userEvent.click(card);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /walk around the block/i }).getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });

  it("queues the check-off when the request fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    await waitFor(async () => {
      expect(await pending()).toHaveLength(1);
    });
    expect((await pending())[0].user_habit_id).toBe("uh-1");
  });

  it("marks a queued check-off as waiting to sync", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    expect(await screen.findByLabelText(/waiting to sync/i)).toBeTruthy();
  });

  it("flushes the queue when the connection comes back", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));
    await waitFor(async () => expect(await pending()).toHaveLength(1));

    // Reconnect: swap in a working fetch, then fire the browser's own signal.
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: false }));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(async () => {
      expect(await pending()).toHaveLength(0);
    });
  });

  it("clears the waiting-to-sync marker once the queue drains", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));
    expect(await screen.findByLabelText(/waiting to sync/i)).toBeTruthy();

    vi.stubGlobal("fetch", mockFetch({ checkinsFail: false }));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/waiting to sync/i)).toBeNull();
    });
  });

  it("flushes anything left over from a previous visit on mount", async () => {
    const { enqueue } = await import("../../src/app/offline-queue");
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    const fetchMock = mockFetch({ checkinsFail: false });
    vi.stubGlobal("fetch", fetchMock);

    render(<Today />);

    await waitFor(async () => {
      expect(await pending()).toHaveLength(0);
    });
    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        const body = (init as RequestInit | undefined)?.body;
        return String(url).includes("/checkin") && String(body).includes("2026-07-14");
      }),
    ).toBe(true);
  });

  it("does not leave a queued item behind when the user undoes the check-off", async () => {
    vi.stubGlobal("fetch", mockFetch({ checkinsFail: true }));

    render(<Today />);
    const card = await screen.findByRole("button", { name: /walk around the block/i });
    await userEvent.click(card);
    await waitFor(async () => expect(await pending()).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /walk around the block/i }));

    await waitFor(async () => {
      expect(await pending()).toHaveLength(0);
    });
  });
});
