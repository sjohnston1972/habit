/**
 * Store-and-forward for check-offs (CLAUDE.md §9).
 *
 * A tap made on a train goes into IndexedDB and is replayed when the link
 * comes back. The queued item carries **the local date it was made on**, so a
 * Tuesday check-off still counts for Tuesday even if it syncs on Wednesday.
 *
 * Replay is safe by construction: `checkins` is uniquely keyed on
 * (user_habit_id, local_date), so sending the same item twice inserts once.
 * The queue therefore never needs to reason about whether it already sent
 * something — it only needs to not lose it.
 */

const DB_NAME = "clydeford-habits";
const DB_VERSION = 1;
const STORE = "pending-checkins";

export interface QueuedCheckin {
  user_habit_id: string;
  local_date: string;
}

/** One row per habit per day — the same key the server enforces. */
function keyFor(item: QueuedCheckin): string {
  return `${item.user_habit_id}:${item.local_date}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

interface StoredItem extends QueuedCheckin {
  key: string;
  queued_at: number;
}

export async function enqueue(item: QueuedCheckin): Promise<void> {
  // `put` rather than `add`: re-queueing the same habit and day overwrites
  // rather than throwing, which keeps the store one-row-per-day.
  await runTransaction("readwrite", (store) =>
    store.put({ ...item, key: keyFor(item), queued_at: Date.now() } satisfies StoredItem),
  );
}

export async function pending(): Promise<QueuedCheckin[]> {
  const items = await runTransaction<StoredItem[]>("readonly", (store) => store.getAll());

  return items
    .sort((a, b) => a.queued_at - b.queued_at)
    .map(({ user_habit_id, local_date }) => ({ user_habit_id, local_date }));
}

async function remove(item: QueuedCheckin): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(keyFor(item)));
}

export async function clearQueue(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Try to send everything queued. An item is dropped once the server has taken
 * a view on it — success, or a 4xx saying it never can succeed. Anything else
 * (network failure, 5xx) leaves it queued for the next attempt.
 */
export interface FlushedItem extends QueuedCheckin {
  outcome?: string;
  streak?: { current: number; best: number; repair_available: boolean };
}

export async function flush(
  fetchFn: FetchLike,
): Promise<{ sent: number; remaining: number; flushed: FlushedItem[] }> {
  const items = await pending();
  const flushed: FlushedItem[] = [];

  for (const item of items) {
    try {
      const res = await fetchFn(`/api/user-habits/${item.user_habit_id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_date: item.local_date }),
      });

      // 4xx is a permanent no: retrying forever would wedge the queue behind
      // an item that can never land.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await remove(item);

        // The server's verdict travels back with the item so the UI can
        // celebrate a repair even when the check-off happened hours ago.
        const body = res.ok ? await res.json().catch(() => null) : null;
        flushed.push({ ...item, ...(body as object | null) });
      }
    } catch {
      // Still offline. Keep it; try again on the next `online` event.
    }
  }

  return { sent: flushed.length, remaining: (await pending()).length, flushed };
}

/** Drop a queued item without sending it — used when the user undoes an offline check-off. */
export async function dequeue(item: QueuedCheckin): Promise<void> {
  await remove(item);
}
