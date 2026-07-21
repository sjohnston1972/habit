import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "../src/worker/resend-email";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fetch stand-in that records the request and returns a chosen response. */
function stubFetch(response: { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body ?? { id: "email-1" }), {
      status: response.status,
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const FROM = "Clydeford Habits <noreply@clydeford.net>";

describe("ResendEmailSender", () => {
  it("posts the magic link to the Resend API with the bearer key", async () => {
    const { fn, calls } = stubFetch({ status: 200 });
    const sender = new ResendEmailSender("re_test_key", FROM, fn);

    await sender.send("user@example.com", "https://habit.clydeford.net/api/auth/callback?token=abc");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends from the configured address to the requesting user", async () => {
    const { fn, calls } = stubFetch({ status: 200 });
    const sender = new ResendEmailSender("re_test_key", FROM, fn);

    await sender.send("user@example.com", "https://habit.clydeford.net/api/auth/callback?token=abc");

    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.from).toBe(FROM);
    expect(payload.to).toBe("user@example.com");
    expect(payload.subject).toBeTruthy();
  });

  it("puts the clickable link in both the HTML and plain-text bodies", async () => {
    const { fn, calls } = stubFetch({ status: 200 });
    const sender = new ResendEmailSender("re_test_key", FROM, fn);
    const link = "https://habit.clydeford.net/api/auth/callback?token=abc123";

    await sender.send("user@example.com", link);

    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.html).toContain(link);
    expect(payload.text).toContain(link);
  });

  it("escapes the link so it cannot break out of the HTML attribute", async () => {
    const { fn, calls } = stubFetch({ status: 200 });
    const sender = new ResendEmailSender("re_test_key", FROM, fn);
    // A token can only be a uuid pair in practice, but the sender must not
    // assume that — the href must be attribute-safe regardless.
    const link = 'https://habit.clydeford.net/api/auth/callback?token="><script>x';

    await sender.send("user@example.com", link);

    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.html).not.toContain('"><script>');
    expect(payload.html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("calls fetch without rebinding `this` to the sender (Workers Illegal invocation)", async () => {
    // Workers' native fetch throws "Illegal invocation" when called as a
    // method (this = the instance). A plain-function stub that guards `this`
    // reproduces that constraint without a network call.
    const seen: string[] = [];
    function guardedFetch(this: unknown, url: string | URL | Request): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      seen.push(String(url));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }

    const sender = new ResendEmailSender(
      "re_test_key",
      FROM,
      guardedFetch as unknown as typeof fetch,
    );

    await expect(
      sender.send("user@example.com", "https://habit.clydeford.net/api/auth/callback?token=abc"),
    ).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it("throws when Resend rejects the send, so the caller can surface a failure", async () => {
    const { fn } = stubFetch({ status: 422, body: { message: "domain not verified" } });
    const sender = new ResendEmailSender("re_test_key", FROM, fn);

    await expect(
      sender.send("user@example.com", "https://habit.clydeford.net/api/auth/callback?token=abc"),
    ).rejects.toThrow(/resend/i);
  });

  it("throws on a network failure rather than swallowing it", async () => {
    const fn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const sender = new ResendEmailSender("re_test_key", FROM, fn);

    await expect(
      sender.send("user@example.com", "https://habit.clydeford.net/api/auth/callback?token=abc"),
    ).rejects.toThrow();
  });
});
