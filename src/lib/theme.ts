"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// appearance: light, dark or system. the choice lives in localStorage (works signed out)
// and, when signed in, in the supabase user's metadata so it follows them to other
// devices. a tiny inline script (THEME_SCRIPT, in the root layout) applies it before
// first paint, so there's no flash of the wrong theme and no hydration mismatch.

export { THEME_COLORS, THEME_KEY, THEME_SCRIPT, type ResolvedTheme, type ThemePref } from "./theme-script";
import { THEME_COLORS, THEME_KEY, type ResolvedTheme, type ThemePref } from "./theme-script";

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function readPref(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY); return isPref(v) ? v : "system"; } catch { return "system"; }
}
export const resolve = (p: ThemePref): ResolvedTheme => (p === "system" ? (systemDark() ? "dark" : "light") : p);

/** applies a preference to the page: the dark class, color-scheme and the browser theme colour */
export function applyTheme(p: ThemePref) {
  const r = document.documentElement;
  const t = resolve(p);
  r.classList.toggle("dark", t === "dark");
  r.style.colorScheme = t;
  r.dataset.theme = p;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    // explicit choice: every theme-color tag uses it. system: each tag keeps its own media colour.
    const media = m.getAttribute("media") ?? "";
    m.setAttribute("content", p === "system" ? (media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light) : THEME_COLORS[t]);
  });
}

// a tiny store so every toggle on the page stays in sync
const listeners = new Set<() => void>();
let current: ThemePref | null = null;
const get = () => (current ??= readPref());
function emit() { listeners.forEach((l) => l()); }

/** set and persist a preference. `sync` writes it to the signed-in account too. */
export function setThemePref(p: ThemePref, opts: { sync?: (p: ThemePref) => void } = {}) {
  current = p;
  try { if (p === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, p); } catch { /* private mode: still applies for this visit */ }
  applyTheme(p);
  emit();
  opts.sync?.(p);
}

/** adopt the account's saved preference when this browser has no explicit choice yet */
export function adoptAccountPref(v: unknown) {
  if (!isPref(v)) return;
  let local: string | null = null;
  try { local = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (!local && v !== get()) setThemePref(v);
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    get,
    () => "system" as ThemePref, // server render: unknown, the head script already painted the right theme
  );
  // follow the device while on "system"
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => { applyTheme("system"); emit(); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  const set = useCallback((p: ThemePref) => setThemePref(p, { sync: syncToAccount }), []);
  return { pref, resolved: typeof window === "undefined" ? ("light" as ResolvedTheme) : resolve(pref), set };
}

/** saves the preference on the signed-in supabase user (no-op when signed out) */
async function syncToAccount(p: ThemePref) {
  try {
    const { supabase, getState } = await import("@/lib/store/store");
    if (!getState().session.userId) return;
    const sb = await supabase();
    await sb.auth.updateUser({ data: { theme: p } });
  } catch { /* best effort: the local choice already applied */ }
}
