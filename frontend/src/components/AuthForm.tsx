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

  const input = "w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500";
  return (
    <main className="mx-auto max-w-sm space-y-5 p-6 pt-12">
      <h1 className="text-2xl font-bold">{isSignup ? "Create your account" : "Welcome back"}</h1>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (isSignup ? signup(email, password, name) : login(email, password)));
        }}
      >
        {isSignup && (
          <input className={input} placeholder="Name" value={name} maxLength={120}
            onChange={(e) => setName(e.target.value)} autoComplete="name" />
        )}
        <input className={input} type="email" placeholder="Email" required value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input className={input} type="password" required minLength={isSignup ? 8 : 1} maxLength={72}
          placeholder={isSignup ? "Password (min 8 characters)" : "Password"} value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSignup ? "new-password" : "current-password"} />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-emerald-500 py-2 font-medium text-slate-950 disabled:opacity-50">
          {busy ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>

      {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="h-px flex-1 bg-slate-800" />or<div className="h-px flex-1 bg-slate-800" />
          </div>
          <GoogleButton text={isSignup ? "signup_with" : "signin_with"}
            onCredential={(c) => run(() => google(c))} />
        </>
      )}

      <p className="text-center text-sm text-slate-400">
        {isSignup ? "Already have an account?" : "New here?"}{" "}
        <Link className="text-emerald-400 hover:underline" href={isSignup ? "/login" : "/signup"}>
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </main>
  );
}
