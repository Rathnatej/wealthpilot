"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GoogleButton } from "@/components/GoogleButton";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/services/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { user, login, signup, google } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSignup = mode === "signup";

  useEffect(() => {
    if (user) router.replace("/twin");
  }, [user, router]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-page flex justify-center py-12 sm:py-20">
      <div className="card w-full max-w-md">
        <h1 className="display text-3xl sm:text-4xl">{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-2 text-body">
          {isSignup ? "Save your financial twin and track goals over time." : "Log in to see your twin and goals."}
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => (isSignup ? signup(email, password, name) : login(email, password)));
          }}
        >
          {isSignup && (
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input id="name" className="input" placeholder="Your name" value={name} maxLength={120}
                onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" placeholder="you@example.com" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" required minLength={isSignup ? 8 : 1} maxLength={72}
              placeholder={isSignup ? "At least 8 characters" : "Your password"} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"} />
          </div>
          {error && <p role="alert" className="text-sm font-medium text-down">{error}</p>}
          <button disabled={busy} className="btn-primary w-full">
            {busy ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
          </button>
        </form>

        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
              <div className="h-px flex-1 bg-hairline" />or<div className="h-px flex-1 bg-hairline" />
            </div>
            <GoogleButton text={isSignup ? "signup_with" : "signin_with"}
              onCredential={(c) => run(() => google(c))} />
          </>
        )}

        <p className="mt-8 text-center text-sm text-body">
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <Link className="font-semibold text-primary hover:underline" href={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Log in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
