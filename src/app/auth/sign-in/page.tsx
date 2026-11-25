"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInDemo } from "@/lib/store/store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth-ui";
import { useAction } from "@/components/ui";

export default function SignInPage() {
  const router = useRouter();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const sb = getBrowserSupabase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(async () => {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("enter a valid email");
      if (password.length < 8) throw new Error("passwords are at least 8 characters");
      if (sb) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message.toLowerCase());
      }
      signInDemo(email);
      return true;
    }, "welcome back");
    setBusy(false);
    if (ok) router.push("/");
  };

  return (
    <AuthFrame title="welcome back" subtitle="sign in to settle some arguments." footer={<>new here? <Link href="/auth/sign-up" className="font-semibold text-ink underline">create an account</Link></>}>
      {!sb && (
        <>
          <button className="btn-primary w-full" onClick={() => { signInDemo(); router.push("/"); }}>continue with the demo account</button>
          <div className="my-5 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />or sign in with email<span className="h-px flex-1 bg-line" /></div>
        </>
      )}
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="em">email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="pw">password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
        <div className="text-right"><Link href="/auth/reset" className="text-sm text-muted underline">forgot password?</Link></div>
        <button className={sb ? "btn-primary w-full" : "btn-dark w-full"} disabled={busy}>{busy ? "signing in…" : "sign in"}</button>
      </form>
    </AuthFrame>
  );
}
