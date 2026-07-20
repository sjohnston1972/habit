import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueue, enqueue, flush, pending } from "../../src/app/offline-queue";

beforeEach(async () => {
  await clearQueue();
});

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ outcome: "incremented" }), { status: 200 }));
}

function failingFetch() {
  return vi.fn(async () => {
    throw new Error("offline");
  });
}

describe("offline queue", () => {
  it("starts empty", async () => {
    expect(await pending()).toEqual([]);
  });

  it("holds a queued check-in", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    const items = await pending();

    expect(items).toHaveLength(1);
    expect(items[0].user_habit_id).toBe("uh-1");
    expect(items[0].local_date).toBe("2026-07-14");
  });

  it("clears the queue once the server accepts each item", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });
    await enqueue({ user_habit_id: "uh-2", local_date: "2026-07-14" });

    await flush(okFetch());

    expect(await pending()).toEqual([]);
  });

  it("posts the local date the check-off was made on, not today's", async () => {
    const fetchMock = okFetch();
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    await flush(fetchMock);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/user-habits/uh-1/checkin");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ local_date: "2026-07-14" });
  });

  it("keeps an item queued when the network fails", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    await flush(failingFetch());

    expect(await pending()).toHaveLength(1);
  });

  it("keeps an item queued when the server returns a 5xx", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    await flush(vi.fn(async () => new Response("boom", { status: 500 })));

    expect(await pending()).toHaveLength(1);
  });

  it("drops an item the server rejects outright, rather than retrying forever", async () => {
    // A 404 means the habit is gone. Retrying it on every flush would block the
    // queue behind an item that can never succeed.
    await enqueue({ user_habit_id: "uh-gone", local_date: "2026-07-14" });

    await flush(vi.fn(async () => new Response("nope", { status: 404 })));

    expect(await pending()).toEqual([]);
  });

  it("sends the same local date every time an item is replayed", async () => {
    const first = failingFetch();
    const second = okFetch();
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    await flush(first);
    await flush(second);

    const bodyOf = (mock: ReturnType<typeof okFetch>) =>
      JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body));

    expect(bodyOf(first as unknown as ReturnType<typeof okFetch>)).toEqual({
      local_date: "2026-07-14",
    });
    expect(bodyOf(second)).toEqual({ local_date: "2026-07-14" });
  });

  it("survives a page reload — the queue is on disk, not in memory", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    // A fresh import is the closest stand-in for a reload; IndexedDB persists.
    const reloaded = await import("../../src/app/offline-queue");

    expect(await reloaded.pending()).toHaveLength(1);
  });

  it("does not double-queue the same habit and date", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });

    expect(await pending()).toHaveLength(1);
  });

  it("queues the same habit separately for different days", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-15" });

    expect(await pending()).toHaveLength(2);
  });

  it("leaves later items queued when an earlier one fails", async () => {
    await enqueue({ user_habit_id: "uh-1", local_date: "2026-07-14" });
    await enqueue({ user_habit_id: "uh-2", local_date: "2026-07-14" });

    let call = 0;
    await flush(
      vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("offline");
        return new Response("{}", { status: 200 });
      }),
    );

    const items = await pending();
    expect(items).toHaveLength(1);
    expect(items[0].user_habit_id).toBe("uh-1");
  });
});
