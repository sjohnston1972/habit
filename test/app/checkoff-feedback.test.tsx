import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import confetti from "canvas-confetti";
import { celebrateCheckoff, prefersReducedMotion } from "../../src/app/feedback";
import { Today } from "../../src/app/screens/Today";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const confettiMock = vi.mocked(confetti);

/** Point matchMedia at a given reduced-motion answer. */
function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function setVibrationSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(navigator, "vibrate", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  } else {
    // @ts-expect-error — deliberately removing an optional platform API.
    delete navigator.vibrate;
  }
}

beforeEach(() => {
  confettiMock.mockClear();
  setReducedMotion(false);
  setVibrationSupport(true);
});

afterEach(() => {
  setVibrationSupport(false);
});

describe("celebrateCheckoff", () => {
  it("fires confetti when a habit is completed", () => {
    celebrateCheckoff("incremented");

    expect(confettiMock).toHaveBeenCalled();
  });

  it("buzzes the phone when the Vibration API is available", () => {
    celebrateCheckoff("incremented");

    expect(navigator.vibrate).toHaveBeenCalled();
  });

  it("does not attempt to vibrate on a device without the API", () => {
    setVibrationSupport(false);

    expect(() => celebrateCheckoff("incremented")).not.toThrow();
  });

  it("fires nothing at all when the user asked their phone for less motion", () => {
    setReducedMotion(true);

    celebrateCheckoff("incremented");

    expect(confettiMock).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it("still fires nothing on a repair when motion is reduced", () => {
    setReducedMotion(true);

    celebrateCheckoff("repaired");

    expect(confettiMock).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it("celebrates a repair more loudly than an ordinary day", () => {
    celebrateCheckoff("incremented");
    const ordinary = confettiMock.mock.calls[0]?.[0]?.particleCount ?? 0;
    confettiMock.mockClear();

    celebrateCheckoff("repaired");
    const repaired = confettiMock.mock.calls[0]?.[0]?.particleCount ?? 0;

    expect(repaired).toBeGreaterThan(ordinary);
  });

  it("does not celebrate an undo", () => {
    celebrateCheckoff("noop");

    expect(confettiMock).not.toHaveBeenCalled();
  });
});

describe("prefersReducedMotion", () => {
  it("reports what the user's device says", () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);

    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("assumes motion is fine when matchMedia is unavailable", () => {
    // @ts-expect-error — some older embedded browsers genuinely lack it.
    delete window.matchMedia;

    expect(prefersReducedMotion()).toBe(false);
  });
});

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

function mockFetchWithOutcome(outcome: string) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET" && url.includes("/api/today")) {
      return new Response(JSON.stringify({ habits: [ACTIVE_HABIT] }), { status: 200 });
    }
    if (method === "GET" && url.includes("/api/suggestions")) {
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ outcome, streak: { current: 4, best: 8, repair_available: false } }),
      { status: 200 },
    );
  });
}

describe("check-off feedback in the Today screen", () => {
  it("celebrates a saved streak warmly rather than scolding", async () => {
    vi.stubGlobal("fetch", mockFetchWithOutcome("repaired"));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    expect(await screen.findByText(/phew — saved it/i)).toBeTruthy();
  });

  it("frames a broken streak as a fresh start, never a warning", async () => {
    vi.stubGlobal("fetch", mockFetchWithOutcome("reset"));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    const message = await screen.findByText(/fresh start/i);
    expect(message).toBeTruthy();
    // Tone guardrail: encouragement, not a red alert (CLAUDE.md §10).
    expect(message.className).not.toContain("red");
  });

  it("fires confetti on an ordinary completed day", async () => {
    vi.stubGlobal("fetch", mockFetchWithOutcome("incremented"));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    await waitFor(() => expect(confettiMock).toHaveBeenCalled());
  });

  it("fires no confetti when the user has asked for reduced motion", async () => {
    setReducedMotion(true);
    vi.stubGlobal("fetch", mockFetchWithOutcome("incremented"));

    render(<Today />);
    await userEvent.click(await screen.findByRole("button", { name: /walk around the block/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /walk/i })).toBeTruthy());
    expect(confettiMock).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });
});
