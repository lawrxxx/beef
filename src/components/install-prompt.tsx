"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { dismissInstall, useBeef } from "@/lib/store/store";
import { Sheet } from "@/components/ui";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const COOLDOWN = 7 * 24 * 3600e3;

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIPEvent; subs.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; subs.forEach((f) => f()); });
}

/** install state usable anywhere (profile settings uses it too) */
export function useInstall() {
  const [, force] = useState(0);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIOS());
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return {
    installed: standalone,
    canPrompt: !!deferred,
    ios,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const r = await deferred.userChoice;
      deferred = null;
      return r.outcome === "accepted";
    },
  };
}

export function IOSGuide() {
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-soft">want beef on your home screen?</p>
      <ol className="space-y-3 text-[15px]">
        <li className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5"><Share size={18} /></span>tap <b>share</b> in safari's toolbar</li>
        <li className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5"><SquarePlus size={18} /></span>select <b>add to home screen</b></li>
        <li className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5">🥩</span>open beef from your home screen</li>
      </ol>
    </div>
  );
}

/**
 * shows once a user has had a moment to look around (20s), never in standalone
 * mode, and backs off for a week after a dismissal.
 */
export function InstallPrompt() {
  const s = useBeef();
  const inst = useInstall();
  const [ready, setReady] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 20_000);
    return () => clearTimeout(t);
  }, []);
  const recentlyDismissed = s.installDismissedAt && Date.now() - s.installDismissedAt < COOLDOWN;
  const show = ready && !inst.installed && !recentlyDismissed && (inst.canPrompt || inst.ios);

  return (
    <>
      {show && (
        <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md animate-fade-up lg:bottom-6 lg:left-auto lg:right-6">
          <div className="flex items-center gap-3 rounded-lg border-2 border-ink bg-surface p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white"><Download size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">put beef on your home screen</p>
              <p className="text-xs text-muted">opens full screen, like an app</p>
            </div>
            <button
              className="btn-dark btn-sm"
              onClick={async () => {
                if (inst.canPrompt) { const ok = await inst.prompt(); if (!ok) dismissInstall(); }
                else setGuide(true);
              }}
            >install</button>
            <button className="btn-ghost btn-sm !px-2" aria-label="not now" onClick={() => dismissInstall()}><X size={18} /></button>
          </div>
        </div>
      )}
      <Sheet open={guide} onClose={() => { setGuide(false); dismissInstall(); }} title="add beef to your home screen">
        <IOSGuide />
      </Sheet>
    </>
  );
}
