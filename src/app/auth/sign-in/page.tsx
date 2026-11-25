"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getState, reloadRemote, supabase } from "@/lib/store/store";
import { AuthFrame, Divider, GoogleButton } from "@/components/auth-ui";
import { useAction } from "@/components/ui";

export default function SignInPage() {
  const router = useRouter();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="welcome back" subtitle="sign in to settle some arguments." footer={<>new here? <Link href="/auth/sign-up" className="font-semibold text-ink underline">create an account</Link></>}>
      <GoogleButton />
      <Divider />
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const ok = await run(async () => {
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("enter a valid email");
          if (password.length < 8) throw new Error("passwords are at least 8 characters");
          const sb = await supabase();
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(/invalid login/i.test(error.message) ? "wrong email or password" : /not confirmed/i.test(error.message) ? "confirm your email first: check your inbox" : error.message.toLowerCase());
          await reloadRemote();
          return true;
        });
        setBusy(false);
        if (ok) router.push(getState().session.hasProfile && getState().session.onboarded ? "/" : "/onboarding");
      }}>
        <div><label className="label" htmlFor="em">email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="pw">password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
        <div className="text-right"><Link href="/auth/reset" className="text-sm text-muted underline">forgot password?</Link></div>
        <button className="btn-dark w-full" disabled={busy}>{busy ? "signing in…" : "sign in"}</button>
      </form>
    </AuthFrame>
  );
}
