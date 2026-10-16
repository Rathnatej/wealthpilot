"use client";
import { useEffect, useRef } from "react";

type GsiResponse = { credential: string };
type Gsi = {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: GsiResponse) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gsi;
  }
}

/** Google Identity Services button. Returns a Google ID token to `onCredential`. */
export function GoogleButton({
  onCredential,
  text = "continue_with",
}: {
  onCredential: (credential: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with";
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const holder = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    if (!clientId) return;
    const render = () => {
      if (!window.google || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => cb.current(r.credential),
      });
      holder.current.innerHTML = "";
      window.google.accounts.id.renderButton(holder.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        width: 320,
        text,
      });
    };
    if (window.google) {
      render();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>("script[data-gsi]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.gsi = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
  }, [clientId, text]);

  if (!clientId) return null;
  return <div ref={holder} className="flex min-h-[44px] justify-center" />;
}
