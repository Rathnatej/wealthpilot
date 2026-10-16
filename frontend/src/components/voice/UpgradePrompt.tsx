"use client";
import Link from "next/link";

/** Paywall hook. The page renders this only when /voice/config returns reason="upgrade_required",
 *  which happens once the backend flag VOICE_PAID_ONLY=true is set. Hidden until then.
 *  Point `href` at your pricing/checkout page when billing exists. */
export function UpgradePrompt({ href = "/pricing" }: { href?: string }) {
  return (
    <div role="region" aria-label="Upgrade"
      className="mx-auto max-w-md rounded-3xl bg-white/5 p-8 text-center ring-1 ring-white/10">
      <h2 className="text-2xl font-semibold text-white">Voice conversations are a Pro feature</h2>
      <p className="mt-3 text-white/75">Upgrade to talk with your assistant by voice, in your own language, with
        guidance based on your real numbers.</p>
      <Link href={href} className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-semibold text-[#0b1220] hover:bg-white/90">
        See plans
      </Link>
      <Link href="/chat" className="mt-3 block text-sm text-white/70 underline">Keep using the text chat for free</Link>
    </div>
  );
}
