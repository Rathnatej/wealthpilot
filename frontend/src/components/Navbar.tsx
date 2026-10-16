"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/", label: "Simulator" },
  { href: "/twin", label: "My Twin" },
  { href: "/goals", label: "Goals" },
  { href: "/credit", label: "Credit coach" },
];

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-6">
        <Link href="/" className="text-xl font-semibold tracking-tight text-primary">WealthPilot</Link>

        <div className="hidden gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-pill px-4 py-2 text-sm font-medium ${path === l.href ? "bg-strong text-ink" : "text-body hover:text-ink"}`}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {loading ? null : user ? (
            <button onClick={logout} className="btn-secondary btn-sm hidden sm:inline-flex">Log out</button>
          ) : (
            <>
              <Link href="/login" className="hidden px-3 text-sm font-medium text-ink sm:inline">Log in</Link>
              <Link href="/signup" className="btn-primary btn-sm">Sign up</Link>
            </>
          )}
          <button onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-strong text-ink md:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-hairline bg-canvas md:hidden">
          <div className="container-page flex flex-col py-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
                className={`rounded-md px-2 py-3 text-base font-medium ${path === l.href ? "text-primary" : "text-ink"}`}>
                {l.label}
              </Link>
            ))}
            {!loading && user && (
              <button onClick={() => { setOpen(false); logout(); }} className="px-2 py-3 text-left text-base font-medium text-ink">Log out</button>
            )}
            {!loading && !user && (
              <Link href="/login" onClick={() => setOpen(false)} className="px-2 py-3 text-base font-medium text-ink">Log in</Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
