"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useMounted } from "@/lib/hooks";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cx } from "@/lib/format";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "light", Icon: Sun },
  { value: "dark", label: "dark", Icon: Moon },
  { value: "system", label: "system", Icon: Monitor },
];

/** light / dark / system, as an accessible radio group (profile settings) */
export function ThemeSelector({ className }: { className?: string }) {
  const { pref, set } = useTheme();
  const mounted = useMounted();
  const value = mounted ? pref : null; // the saved choice is only known in the browser
  return (
    <div role="radiogroup" aria-label="appearance" className={cx("grid grid-cols-3 gap-1 rounded-xl bg-ink/[.05] p-1", className)}>
      {OPTIONS.map(({ value: v, label, Icon }) => {
        const on = value === v;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => set(v)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = OPTIONS.findIndex((o) => o.value === (value ?? "system"));
              const next = OPTIONS[(i + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length];
              set(next.value);
              (e.currentTarget.parentElement?.querySelectorAll("button")[OPTIONS.indexOf(next)] as HTMLButtonElement | undefined)?.focus();
            }}
            tabIndex={on || (!value && v === "system") ? 0 : -1}
            className={cx("flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition", on ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink")}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        );
      })}
    </div>
  );
}

/** one-tap toggle for the navigation: cycles light → dark → system */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, resolved, set } = useTheme();
  const mounted = useMounted();
  const next: ThemePref = pref === "light" ? "dark" : pref === "dark" ? "system" : "light";
  const Icon = !mounted ? Sun : pref === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const label = mounted ? `appearance: ${pref}${pref === "system" ? ` (${resolved})` : ""}. switch to ${next}` : "appearance";
  return (
    <button type="button" onClick={() => set(next)} aria-label={label} title={label}
      className={cx("inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-ink/5", className)}>
      <Icon size={20} aria-hidden />
    </button>
  );
}
