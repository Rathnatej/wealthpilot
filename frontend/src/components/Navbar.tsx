"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const links = [
  { href: "/", label: "Simulator" },
  { href: "/twin", label: "My Twin" },
  { href: "/goals", label: "Goals" },
];

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
        <Link href="/" className="text-lg font-bold text-emerald-400">WealthPilot</Link>
        <div className="flex gap-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-md px-3 py-1.5 ${path === l.href ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {loading ? null : user ? (
            <>
              <span className="hidden text-slate-400 sm:inline">{user.name || user.email}</span>
              <button onClick={logout} className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700">Log out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-1.5 text-slate-300 hover:text-white">Log in</Link>
              <Link href="/signup" className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-slate-950">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
