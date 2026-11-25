"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col py-8">
      <Logo />
      <div className="mt-10 animate-fade-up">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {!isSupabaseConfigured() && (
        <p className="mt-6 rounded-xl bg-gold-soft p-3 text-[13px] text-ink-soft">
          <b>demo mode.</b> no backend is configured, so accounts are local to this browser and no email is sent. your password is never stored.
        </p>
      )}
      <div className="mt-auto pt-8 text-center text-sm text-muted">{footer}<p className="mt-3"><Link href="/" className="underline">browse without an account</Link></p></div>
    </div>
  );
}
