import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-canvas">
      <div className="container-page py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <p className="text-xl font-semibold tracking-tight text-primary">WealthPilot</p>
            <p className="mt-2 text-sm text-body">See where your money could go. Every number comes from a deterministic engine, never from an AI guess.</p>
          </div>
          <div className="flex gap-12 text-sm">
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-ink">Product</span>
              <Link href="/" className="text-body hover:text-ink">Simulator</Link>
              <Link href="/twin" className="text-body hover:text-ink">My Twin</Link>
              <Link href="/goals" className="text-body hover:text-ink">Goals</Link>
              <Link href="/credit" className="text-body hover:text-ink">Credit coach</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-ink">Account</span>
              <Link href="/login" className="text-body hover:text-ink">Log in</Link>
              <Link href="/signup" className="text-body hover:text-ink">Sign up</Link>
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-hairline pt-6 text-xs text-muted">
          Educational projections only, not investment advice. Past returns do not guarantee future results.
        </p>
      </div>
    </footer>
  );
}
