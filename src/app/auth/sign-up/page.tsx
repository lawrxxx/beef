"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { reloadRemote, signUpDemo } from "@/lib/store/store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth-ui";
import { useAction } from "@/components/ui";

export default function SignUpPage() {
  const router = useRouter();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sb = getBrowserSupabase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(async () => {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("enter a valid email");
      if (password.length < 8) throw new Error("use at least 8 characters");
      if (!adult) throw new Error("you need to be 18 or older");
      if (sb) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/onboarding` } });
        if (error) throw new Error(error.message.toLowerCase());
        if (!data.session) { setSent(true); return false; }
        await reloadRemote();
        return true;
      }
      signUpDemo(email);
      return true;
    });
    setBusy(false);
    if (ok) router.push("/onboarding");
  };

  if (sent) {
    return (
      <AuthFrame title="check your inbox" subtitle={`we sent a confirmation link to ${email}.`}>
        <div className="card flex items-center gap-3 p-4"><MailCheck className="text-gain" /> open it on this device to finish setting up.</div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="join beef" subtitle="put your money where your mouth is. (practice money, for now.)" footer={<>already have an account? <Link href="/auth/sign-in" className="font-semibold text-ink underline">sign in</Link></>}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="em">email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="pw">password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /><p className="mt-1 text-xs text-muted">at least 8 characters.</p></div>
        <label className="flex items-start gap-3 py-1 text-sm text-ink-soft">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#1D1D1F]" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>i'm 18 or older and agree that beef is for entertainment. read the <Link href="/rules#risk" className="underline">risk disclosure</Link>.</span>
        </label>
        <button className="btn-primary w-full" disabled={busy || !adult}>{busy ? "creating…" : "create account"}</button>
      </form>
    </AuthFrame>
  );
}
