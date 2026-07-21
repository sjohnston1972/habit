import type { EmailSender } from "./magic-link";

/**
 * Sends magic-link emails through Resend (CLAUDE.md §3, §15 #2).
 *
 * The API key and from-address are injected, and `fetch` is a constructor
 * argument so the sender is testable without the network. A non-2xx response
 * or a transport failure throws — the caller decides how loudly to fail; it
 * must not look like a successful send.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Attribute-safe escaping for the one piece of untrusted text we interpolate. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlBody(link: string): string {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html>
  <body style="font-family: system-ui, sans-serif; color: #2f2f2f;">
    <h1 style="color: #2F6F5E;">Your Clydeford Habits sign-in link</h1>
    <p>Tap the button below to sign in. It expires in 15 minutes and works once.</p>
    <p>
      <a href="${safeLink}"
         style="display: inline-block; background: #2F6F5E; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: bold;">
        Sign in
      </a>
    </p>
    <p style="color: #888; font-size: 13px;">If you didn't ask to sign in, you can ignore this email.</p>
  </body>
</html>`;
}

function textBody(link: string): string {
  return [
    "Your Clydeford Habits sign-in link",
    "",
    "Open this link to sign in (expires in 15 minutes, works once):",
    link,
    "",
    "If you didn't ask to sign in, you can ignore this email.",
  ].join("\n");
}

export class ResendEmailSender implements EmailSender {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    fetchFn: typeof fetch = fetch,
  ) {
    // Bind to the global scope. Workers' native fetch throws "Illegal
    // invocation" if called as a method (`this.fetchFn(...)` would set
    // `this` to this instance); binding fixes it regardless of call site.
    this.fetchFn = fetchFn.bind(globalThis);
  }

  async send(email: string, magicLink: string): Promise<void> {
    const response = await this.fetchFn(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: email,
        subject: "Sign in to Clydeford Habits",
        html: htmlBody(magicLink),
        text: textBody(magicLink),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend send failed (${response.status}): ${detail}`);
    }
  }
}
