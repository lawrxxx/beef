"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthFrame } from "@/components/auth-ui";
import { useAction } from "@/components/ui";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const run = useAction();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const sb = getBrowserSupabase();
  return (
    <AuthFrame title="choose a new password">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(async () => {
          if (pw.length < 8) throw new Error("use at least 8 characters");
          if (pw !== pw2) throw new Error("passwords don't match");
          if (!sb) throw new Error("demo mode: password reset needs supabase configured");
          const { error } = await sb.auth.updateUser({ password: pw });
          if (error) throw new Error(error.message.toLowerCase());
          return true;
        }, "password updated");
        if (ok) router.push("/");
      }}>
        <div><label className="label" htmlFor="p1">new password</label><input id="p1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div><label className="label" htmlFor="p2">confirm</label><input id="p2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        <button className="btn-dark w-full">update password</button>
      </form>
    </AuthFrame>
  );
}
