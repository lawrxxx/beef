"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { USERNAME_RE, completeOnboarding, createProfile, signOut, useBeef, usernameAvailable } from "@/lib/store/store";
import { cx } from "@/lib/format";
import { Avatar, CardSkeleton, useAction } from "@/components/ui";
import { Logo } from "@/components/shell";
import { AVATAR_COLORS, AVATAR_EMOJIS } from "@/components/profile-form";
import { uploadAvatar } from "@/components/avatar-upload";
import type { User } from "@/lib/types";

const WalletStep = dynamic(() => import("@/components/wallet/onboarding-wallet").then((m) => m.WalletStep), { ssr: false, loading: () => <CardSkeleton /> });
const FundStep = dynamic(() => import("@/components/wallet/onboarding-wallet").then((m) => m.FundStep), { ssr: false, loading: () => <CardSkeleton /> });
const DoneStep = dynamic(() => import("@/components/wallet/onboarding-wallet").then((m) => m.DoneStep), { ssr: false, loading: () => <CardSkeleton /> });

type Step = "profile" | "wallet" | "fund" | "done";
const ORDER: Step[] = ["profile", "wallet", "fund", "done"];
const COPY: Record<Step, [string, string]> = {
  profile: ["make your profile", "this is how friends find and challenge you."],
  wallet: ["create your wallet", "a base sepolia wallet for test usdc. it's created for you, nothing to install."],
  fund: ["fund your beef wallet", "duels are staked in test usdc. it's free from circle's faucet and has no monetary value."],
  done: ["you're in", "here's where you stand."],
};

function ProfileStep({ onDone }: { onDone: () => void }) {
  const s = useBeef();
  const run = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("🙂");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [check, setCheck] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  const [busy, setBusy] = useState(false);

  // live availability check (debounced). nothing is generated for the person.
  useEffect(() => {
    const un = username.trim().toLowerCase();
    if (!un) { setCheck("idle"); return; }
    if (!USERNAME_RE.test(un)) { setCheck("invalid"); return; }
    setCheck("checking");
    const t = setTimeout(async () => { try { setCheck((await usernameAvailable(un)) ? "free" : "taken"); } catch { setCheck("idle"); } }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const preview = { id: s.session.userId ?? "me", avatar, avatarColor: color } as User;
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const ref = (() => { try { return localStorage.getItem("beef:ref"); } catch { return null; } })();
      const referredBy = ref ? s.users.find((u) => u.username === ref)?.id ?? null : null;
      const ok = await run(async () => { await createProfile({ username, displayName, bio, avatar, avatarColor: color, referredBy }); return true; }, "profile created");
      setBusy(false);
      if (ok) onDone();
    }}>
      <div>
        <label className="label" htmlFor="username">username</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
          <input id="username" className="input !pl-8 !pr-10" value={username} maxLength={20} autoCapitalize="none" autoCorrect="off" autoComplete="off" onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))} placeholder="pick one" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {check === "checking" && <Loader2 size={16} className="animate-spin text-muted" />}
            {check === "free" && <CheckCircle2 size={16} className="text-gain" />}
            {(check === "taken" || check === "invalid") && <XCircle size={16} className="text-loss" />}
          </span>
        </div>
        <p className={cx("mt-1 text-xs", check === "taken" ? "text-loss" : check === "free" ? "text-gain" : "text-muted")} role="status">
          {check === "taken" ? "that username is taken" : check === "free" ? "available" : check === "invalid" ? "3–20 characters: letters, numbers, dots, underscores" : "3–20 characters: letters, numbers, dots, underscores"}
        </p>
      </div>
      <div>
        <label className="label" htmlFor="dn">display name</label>
        <input id="dn" className="input" value={displayName} maxLength={30} onChange={(e) => setDisplayName(e.target.value)} placeholder="what friends call you" />
      </div>
      <div>
        <p className="label">profile photo <span className="font-normal text-muted">(optional)</span></p>
        <div className="flex items-center gap-4">
          <Avatar user={preview} size={64} />
          <button type="button" className="btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Camera size={15} /> upload photo</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = await run(() => uploadAvatar(f, s.session.userId ?? "me"));
            if (url) setAvatar(url);
          }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{AVATAR_EMOJIS.map((x) => <button type="button" key={x} onClick={() => setAvatar(x)} className={cx("flex h-9 w-9 items-center justify-center rounded-full text-lg", avatar === x ? "ring-2 ring-ink" : "bg-black/[.04]")} aria-label={`avatar ${x}`}>{x}</button>)}</div>
        <div className="mt-2 flex gap-1.5">{AVATAR_COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} className={cx("h-7 w-7 rounded-full border", color === c && "ring-2 ring-ink ring-offset-2")} style={{ background: c }} aria-label={`colour ${c}`} />)}</div>
      </div>
      <div>
        <label className="label" htmlFor="bio">bio <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="bio" className="input min-h-[72px] resize-none" value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} placeholder="what's your investing style?" />
      </div>
      <button className="btn-primary w-full" disabled={busy || check !== "free" || !displayName.trim()}>{busy ? "saving…" : "continue"}</button>
    </form>
  );
}

export default function OnboardingPage() {
  const s = useBeef();
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null);

  // resume where the person left off
  useEffect(() => {
    if (!s.session.userId) { router.replace("/auth/sign-up"); return; }
    if (step) return;
    if (!s.session.hasProfile) setStep("profile");
    else if (s.session.onboarded) router.replace("/");
    else setStep("wallet");
  }, [s.session.userId, s.session.hasProfile, s.session.onboarded, step, router]);

  if (!step) return <CardSkeleton />;
  const idx = ORDER.indexOf(step);
  const finish = async () => { await completeOnboarding(); router.push("/"); };

  return (
    <div className="flex min-h-dvh flex-col py-6">
      <div className="flex items-center justify-between">
        {idx > 1 ? <button className="btn-ghost btn-sm -ml-2 !px-2" onClick={() => setStep(ORDER[idx - 1])} aria-label="back"><ArrowLeft size={20} /></button> : <Logo size={24} />}
        <button className="text-sm text-muted underline" onClick={() => void signOut().then(() => router.push("/"))}>sign out</button>
      </div>
      <div className="mt-4 flex gap-1" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <div key={i} className={cx("h-1 flex-1 rounded-full", i <= idx + 1 ? "bg-ink" : "bg-black/10")} />)}</div>
      <p className="mt-6 text-xs font-semibold text-muted">step {idx + 2} of 5</p>
      <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">{COPY[step][0]}</h1>
      <p className="mt-1 text-[15px] text-muted">{COPY[step][1]}</p>
      <div className="mt-6 animate-fade-up" key={step}>
        {step === "profile" && <ProfileStep onDone={() => setStep("wallet")} />}
        {step === "wallet" && <WalletStep onDone={() => setStep("fund")} />}
        {step === "fund" && <FundStep onDone={() => setStep("done")} />}
        {step === "done" && <DoneStep onFinish={() => void finish()} />}
      </div>
      {step === "wallet" && <button className="mt-4 text-center text-sm text-muted underline" onClick={() => setStep("done")}>set up my wallet later</button>}
    </div>
  );
}
