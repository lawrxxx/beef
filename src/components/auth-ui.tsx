"use client";

import { ThemeToggle } from "@/components/theme-controls";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/shell";
import { supabase } from "@/lib/store/store";
import { useAction } from "@/components/ui";

export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col py-8">
      <div className="flex items-center justify-between"><Logo /><ThemeToggle /></div>
      <div className="mt-10 animate-fade-up">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      <div className="mt-auto pt-8 text-center text-sm text-muted">{footer}<p className="mt-3"><Link href="/discover" className="underline">browse without an account</Link></p></div>
    </div>
  );
}

function GoogleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" /></svg>;
}

/** google sign-in through supabase auth (needs the google provider enabled in supabase) */
/** google sign-in plus its "or" divider, shown only when the provider is switched on in supabase */
export function GoogleButton({ label = "continue with google" }: { label?: string }) {
  const run = useAction();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => r.json()).then((j) => setEnabled(!!j?.external?.google)).catch(() => {});
  }, []);
  if (!enabled) return null;
  return (
    <>
      <button type="button" className="btn-outline w-full" onClick={() => run(async () => {
        const sb = await supabase();
        const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/onboarding` } });
        if (error) throw new Error(error.message.toLowerCase());
      })}><GoogleIcon /> {label}</button>
      <Divider />
    </>
  );
}

export const Divider = () => <div className="my-4 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>;
