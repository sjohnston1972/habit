// jsdom ships no IndexedDB, and the check-off path writes to the offline queue
// on every tap — so every app test needs a store, not just the queue's own.
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();

  // A queued check-off must not leak into the next test.
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("clydeford-habits");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

// jsdom implements neither of these, and the check-off interaction touches both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
