"use client";

import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { supabase } from "@/lib/store/store";
import { AuthFrame } from "@/components/auth-ui";
import { useAction } from "@/components/ui";

export default function ResetPage() {
  const run = useAction();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <AuthFrame title="reset your password" subtitle="we'll email you a link to choose a new one." footer={<Link href="/auth/sign-in" className="underline">back to sign in</Link>}>
      {sent ? (
        <div className="card flex items-start gap-3 p-4 text-[15px]">
          <MailCheck className="mt-0.5 shrink-0 text-gain" />
          <p>{`if an account exists for ${email}, a reset link is on its way.`}</p>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(async () => {
            if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("enter a valid email");
            {
              const sb = await supabase();
              const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/update-password` });
              if (error) throw new Error(error.message.toLowerCase());
            }
            return true;
          });
          if (ok) setSent(true);
        }}>
          <div><label className="label" htmlFor="em">email</label><input id="em" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <button className="btn-dark w-full">send reset link</button>
        </form>
      )}
    </AuthFrame>
  );
}
