"use client";
import { useEffect, useRef } from "react";
import type { VoiceState } from "@/lib/voice/engine";

const HUE: Record<VoiceState | "idle", string> = {
  idle: "hue-rotate(0deg) saturate(0.9)",
  connecting: "hue-rotate(0deg) saturate(0.7) brightness(0.9)",
  listening: "hue-rotate(0deg)",
  thinking: "hue-rotate(45deg) saturate(0.9)",
  speaking: "hue-rotate(-28deg) brightness(1.08)",
  reconnecting: "grayscale(0.7) brightness(0.7)",
  ended: "grayscale(0.6) brightness(0.8)",
};

/** A soft breathing orb. Size follows mic level while listening and voice level while speaking.
 *  Animation runs outside React (direct style writes) so it stays smooth. Honors reduced motion. */
export function Orb({ state, getLevels }: { state: VoiceState | "idle"; getLevels: () => { mic: number; out: number } }) {
  const core = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t = 0, smooth = 0;
    const loop = () => {
      t += 0.016;
      const { mic, out } = getLevels();
      const target = state === "speaking" ? out : state === "listening" ? mic * 0.8 : 0;
      smooth += (target - smooth) * 0.16;
      const breathe = reduce ? 0 : Math.sin(t * 1.1) * 0.03;
      const think = state === "thinking" && !reduce ? Math.sin(t * 3) * 0.045 : 0;
      const lvl = reduce ? 0 : smooth;
      if (core.current) core.current.style.transform = `scale(${1 + breathe + think + lvl * 0.3})`;
      if (halo.current) {
        halo.current.style.transform = `scale(${1.25 + breathe * 2 + lvl * 0.8})`;
        halo.current.style.opacity = String(0.35 + lvl * 0.5);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, getLevels]);

  return (
    <div aria-hidden="true" className="relative flex h-56 w-56 items-center justify-center sm:h-72 sm:w-72"
      style={{ filter: HUE[state], transition: "filter 1.2s ease" }}>
      <div ref={halo} className="absolute inset-0 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(120,160,255,0.55), rgba(120,160,255,0) 70%)" }} />
      <div ref={core} className="h-40 w-40 rounded-full shadow-[0_0_60px_rgba(110,150,240,0.45)] sm:h-52 sm:w-52"
        style={{ background: "radial-gradient(circle at 35% 30%, #cfe0ff 0%, #7fa4ec 45%, #3d5fb0 100%)", willChange: "transform" }} />
    </div>
  );
}
