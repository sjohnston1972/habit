import { useState } from "react";
import { PRODUCT } from "@shared/branding";
import { Mascot } from "../components/Mascot";

type Status = "form" | "sending" | "sent" | "error";

// A failed magic link redirects here with ?auth=failed (set by the Worker's
// callback). Redeeming itself is entirely server-side now — this screen only
// collects an email and reports what happened.
function hadFailedLink(): boolean {
  return new URLSearchParams(window.location.search).get("auth") === "failed";
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const linkFailed = hadFailedLink();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");

    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#FFFDF7] px-6 font-body">
      <Mascot mood={status === "error" || linkFailed ? "sad" : "idle"} />
      <h1 className="font-display text-3xl text-[#2F6F5E]">{PRODUCT}</h1>

      {linkFailed && status !== "sent" && (
        <p className="max-w-sm text-center text-sm text-amber-900">
          That sign-in link didn't work — it may have expired or already been used. Request a fresh
          one below.
        </p>
      )}

      {status === "error" && (
        <p className="max-w-sm text-center text-sm text-amber-900">
          Something went wrong sending your link. Try again in a moment.
        </p>
      )}

      {status !== "sent" && (
        <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
          <label className="font-body text-sm" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-2xl border border-[#2F6F5E]/30 px-4 py-3"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-full bg-[#2F6F5E] px-6 py-3 font-display text-white"
          >
            {status === "sending" ? "Sending…" : "Send me a magic link"}
          </button>
        </form>
      )}

      {status === "sent" && (
        <p className="max-w-sm text-center">Check your email for a link to sign in.</p>
      )}
    </main>
  );
}
