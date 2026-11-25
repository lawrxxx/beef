"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { completeOnboarding, updateProfile, useBeef } from "@/lib/store/store";
import { useMe, useMounted } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { CardSkeleton, useAction } from "@/components/ui";
import { ProfileFields, type ProfileDraft } from "@/components/profile-form";
import { UserRow } from "@/components/social";
import { Logo } from "@/components/shell";

const STEPS = ["name", "look", "stocks", "people", "confirm"] as const;
const COUNTRIES = ["united states", "united kingdom", "canada", "australia", "nigeria", "india", "germany", "other"];

export default function OnboardingPage() {
  const s = useBeef();
  const me = useMe();
  const mounted = useMounted();
  const router = useRouter();
  const run = useAction();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [adult, setAdult] = useState(false);
  const [country, setCountry] = useState("");

  useEffect(() => {
    if (me && !draft) {
      const fromEmail = (s.session.email ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 20);
      setDraft({ username: fromEmail.length >= 3 ? fromEmail : me.username, displayName: me.displayName, bio: me.bio, avatar: me.avatar, avatarColor: me.avatarColor, favoriteStocks: me.favoriteStocks });
    }
  }, [me, draft, s.session.email]);

  if (!mounted) return <CardSkeleton />;
  if (!me) { router.replace("/auth/sign-up"); return null; }
  if (!draft) return <CardSkeleton />;

  const suggested = s.users.filter((u) => u.id !== me.id).sort((a, b) => b.favoriteStocks.filter((t) => draft.favoriteStocks.includes(t)).length - a.favoriteStocks.filter((t) => draft.favoriteStocks.includes(t)).length).slice(0, 6);

  const next = async () => {
    if (step === 0) {
      const ok = await run(() => { updateProfile({ username: draft.username, displayName: draft.displayName.trim() || draft.username }); return true; });
      if (!ok) return;
    }
    if (step === 1 || step === 2) await run(() => updateProfile({ avatar: draft.avatar, avatarColor: draft.avatarColor, bio: draft.bio, favoriteStocks: draft.favoriteStocks }));
    if (step === STEPS.length - 1) {
      completeOnboarding(country);
      router.push("/");
      return;
    }
    setStep(step + 1);
  };

  return (
    <div className="flex min-h-dvh flex-col py-6">
      <div className="flex items-center justify-between">
        {step > 0 ? <button className="btn-ghost btn-sm -ml-2 !px-2" onClick={() => setStep(step - 1)} aria-label="back"><ArrowLeft size={20} /></button> : <Logo size={24} />}
        <button className="text-sm text-muted underline" onClick={() => { completeOnboarding(); router.push("/"); }} hidden={step === STEPS.length - 1}>skip</button>
      </div>
      <div className="mt-4 flex gap-1" aria-hidden>{STEPS.map((_, i) => <div key={i} className={cx("h-1 flex-1 rounded-full", i <= step ? "bg-ink" : "bg-black/10")} />)}</div>
      <h1 className="mt-6 font-display text-[26px] font-bold leading-tight tracking-tight">
        {["what should we call you?", "pick your look", "which stocks do you love?", "follow a few people", "one last thing"][step]}
      </h1>
      <p className="mt-1 text-[15px] text-muted">
        {["this is how friends find and challenge you.", "upload a photo or pick an emoji. add a bio if you like.", "we'll use these to suggest duels and people.", "your feed fills up with their takes and duels.", "beef is for adults. confirm to finish."][step]}
      </p>

      <div className="mt-6 animate-fade-up" key={step}>
        {step === 0 && <ProfileFields draft={draft} setDraft={setDraft} userId={me.id} fields={["username", "displayName"]} />}
        {step === 1 && <ProfileFields draft={draft} setDraft={setDraft} userId={me.id} fields={["avatar", "bio"]} />}
        {step === 2 && <ProfileFields draft={draft} setDraft={setDraft} userId={me.id} fields={["stocks"]} />}
        {step === 3 && <div className="card px-4 py-1">{suggested.map((u) => <UserRow key={u.id} userId={u.id} sub={`likes ${u.favoriteStocks.slice(0, 3).join(", ")}`} />)}</div>}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="country">where do you live?</label>
              <select id="country" className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">choose…</option>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">used to decide which features can be offered to you. this version only uses practice money, available everywhere.</p>
            </div>
            <label className="card flex items-start gap-3 p-4 text-sm text-ink-soft">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#1D1D1F]" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <span>i'm 18 or older. i understand beef uses simulated prices and practice money, and that it's entertainment, not financial advice.</span>
            </label>
          </div>
        )}
      </div>

      <div className="mt-auto pt-8">
        <button className="btn-primary w-full" onClick={next} disabled={(step === 0 && draft.username.length < 3) || (step === 4 && (!adult || !country))}>
          {step === STEPS.length - 1 ? "let's beef" : "continue"}
        </button>
      </div>
    </div>
  );
}
