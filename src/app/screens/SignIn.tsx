import { useEffect, useState } from "react";
import { PRODUCT } from "@shared/branding";
import { Mascot } from "../components/Mascot";

type Status = "form" | "sending" | "sent" | "redeeming" | "signed-in" | "error";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("form");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;

    setStatus("redeeming");
    fetch(`/api/auth/callback?token=${encodeURIComponent(token)}`)
      .then((res) => setStatus(res.ok ? "signed-in" : "error"))
      .catch(() => setStatus("error"));
  }, []);

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
      <Mascot mood={status === "signed-in" ? "celebrating" : status === "error" ? "sad" : "idle"} />
      <h1 className="font-display text-3xl text-[#2F6F5E]">{PRODUCT}</h1>

      {status === "redeeming" && <p>Signing you in…</p>}

      {status === "signed-in" && <p>You're signed in! Welcome to {PRODUCT}.</p>}

      {status === "error" && <p>That link didn't work. Try requesting a new one below.</p>}

      {(status === "form" || status === "sending" || status === "error") && (
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

      {status === "sent" && <p>Check your email for a link to sign in.</p>}
    </main>
  );
}
