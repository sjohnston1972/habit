import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HabitCard, type HabitCardHabit } from "../../src/app/components/HabitCard";

const HABIT: HabitCardHabit = {
  user_habit_id: "uh-1",
  title: "Read before bed",
  category: "Learning & Growth",
  level: "tiny",
  tiny_version: "Read one page",
  standard_version: "Read for 15 minutes",
  identity_statement: "I'm someone who reads every day",
  completed: false,
  streak: { current: 4, best: 9 },
};

describe("HabitCard", () => {
  it("shows the habit title", () => {
    render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    expect(screen.getByText("Read before bed")).toBeTruthy();
  });

  it("shows the version matching the adopted level", () => {
    render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    expect(screen.getByText("Read one page")).toBeTruthy();
    expect(screen.queryByText("Read for 15 minutes")).toBeNull();
  });

  it("shows the standard version once the habit has graduated", () => {
    render(<HabitCard habit={{ ...HABIT, level: "standard" }} onToggle={() => {}} />);

    expect(screen.getByText("Read for 15 minutes")).toBeTruthy();
  });

  it("shows the current streak", () => {
    render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    expect(screen.getByText(/4/)).toBeTruthy();
  });

  it("wears its category's accent colour", () => {
    const { container } = render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    // Learning & Growth maps to the `learning` token.
    expect(container.innerHTML).toContain("category-learning");
  });

  it("calls onToggle with the user_habit_id when tapped", async () => {
    const onToggle = vi.fn();
    render(<HabitCard habit={HABIT} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole("button", { name: /read before bed/i }));

    expect(onToggle).toHaveBeenCalledWith("uh-1");
  });

  it("tells assistive tech whether the habit is done", () => {
    const { rerender } = render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");

    rerender(<HabitCard habit={{ ...HABIT, completed: true }} onToggle={() => {}} />);

    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the identity statement — the point of the habit, not the task", () => {
    render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    expect(screen.getByText(/I'm someone who reads every day/)).toBeTruthy();
  });

  it("marks a pending offline check-off so the user knows it hasn't synced", () => {
    render(<HabitCard habit={{ ...HABIT, completed: true }} onToggle={() => {}} pending />);

    expect(screen.getByLabelText(/waiting to sync/i)).toBeTruthy();
  });

  it("keeps every animation behind motion-safe", () => {
    const { container } = render(<HabitCard habit={HABIT} onToggle={() => {}} />);

    const classNames = Array.from(container.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.classList))
      .filter((name) => /^(animate-|transition|duration-|scale-)/.test(name));

    for (const name of classNames) {
      expect(name.startsWith("motion-safe:")).toBe(true);
    }
  });
});
