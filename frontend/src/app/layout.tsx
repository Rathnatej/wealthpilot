import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WealthPilot",
  description: "Financial twin & scenario simulator (educational only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
