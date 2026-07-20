import { useEffect, useState } from "react";
import { SignIn } from "./screens/SignIn";
import { Today } from "./screens/Today";

type Session = "checking" | "signed-in" | "signed-out";

export default function App() {
  const [session, setSession] = useState<Session>("checking");

  useEffect(() => {
    // A magic-link callback still in the URL belongs to SignIn, which redeems
    // it; don't race it by resolving the session first.
    if (new URLSearchParams(window.location.search).get("token")) {
      setSession("signed-out");
      return;
    }

    fetch("/api/me")
      .then((res) => setSession(res.ok ? "signed-in" : "signed-out"))
      .catch(() => setSession("signed-out"));
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
