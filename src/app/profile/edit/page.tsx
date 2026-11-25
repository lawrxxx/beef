"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { updateProfile } from "@/lib/store/store";
import { useMe, useMounted } from "@/lib/hooks";
import { CardSkeleton, useAction } from "@/components/ui";
import { ProfileFields, type ProfileDraft } from "@/components/profile-form";

export default function EditProfilePage() {
  const me = useMe();
  const mounted = useMounted();
  const router = useRouter();
  const run = useAction();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  useEffect(() => {
    if (me && !draft) setDraft({ username: me.username, displayName: me.displayName, bio: me.bio, avatar: me.avatar, avatarColor: me.avatarColor, favoriteStocks: me.favoriteStocks });
  }, [me, draft]);
  if (!mounted) return <CardSkeleton />;
  if (!me) { router.replace("/auth/sign-in"); return null; }
  if (!draft) return <CardSkeleton />;
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/profile" className="btn-ghost btn-sm -ml-2 !px-2"><ArrowLeft size={18} /> profile</Link>
        <h1 className="font-display text-xl font-bold">edit profile</h1>
        <span className="w-16" />
      </div>
      <div className="card p-5"><ProfileFields draft={draft} setDraft={setDraft} userId={me.id} /></div>
      <button className="btn-primary sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-4 w-full lg:bottom-4" onClick={async () => {
        const ok = await run(() => { updateProfile({ ...draft, displayName: draft.displayName.trim() || draft.username }); return true; }, "profile saved");
        if (ok) router.push("/profile");
      }}>save</button>
    </div>
  );
}
