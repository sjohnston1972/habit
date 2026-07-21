import { useEffect, useState } from "react";
import { SignIn } from "./screens/SignIn";
import { Today } from "./screens/Today";

type Session = "checking" | "signed-in" | "signed-out";

export default function App() {
  const [session, setSession] = useState<Session>("checking");

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const token = new URLSearchParams(window.location.search).get("token");

      // The emailed link redeems server-side and redirects here without a
      // token. But if a token does land on the app root, redeem it, then strip
      // it from the URL so a refresh can't replay a now-used token.
      if (token) {
        await fetch(`/api/auth/callback?token=${encodeURIComponent(token)}`).catch(() => {});
        window.history.replaceState({}, "", "/");
      }

      // Single source of truth for "am I signed in": the session cookie, read
      // by /api/me. Whether the cookie was just set by a redeem or already
      // existed, this resolves the same way — no dead-end.
      const res = await fetch("/api/me").catch(() => null);
      if (!cancelled) setSession(res && res.ok ? "signed-in" : "signed-out");
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  if (session === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#FFFDF7] font-body text-slate-500">
        <p>Loading…</p>
      </main>
    );
  }

  return session === "signed-in" ? <Today /> : <SignIn />;
}
