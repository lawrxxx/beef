"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { User } from "@/lib/types";
import { ASSETS } from "@/lib/market/assets";
import { cx } from "@/lib/format";
import { Avatar } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";

export const AVATAR_EMOJIS = ["🧑‍🍳", "🦈", "🐂", "🐻", "🚀", "🔥", "🐸", "🌸", "📈", "🐢", "🦊", "👾", "🎯", "💎", "🍔", "🌮"];
export const AVATAR_COLORS = ["#FDE7D9", "#DCEBFF", "#FBE3EE", "#FFF1CC", "#E3F6EA", "#EAE6FF", "#E6F2EF", "#FFE2DC"];

/** resizes an image to a 256px square jpeg */
async function resizeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const size = 256, c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const m = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export type ProfileDraft = Pick<User, "username" | "displayName" | "bio" | "avatar" | "avatarColor" | "favoriteStocks">;

export function ProfileFields({ draft, setDraft, userId, fields = ["avatar", "username", "displayName", "bio", "stocks"] }: {
  draft: ProfileDraft; setDraft: (d: ProfileDraft) => void; userId: string; fields?: ("avatar" | "username" | "displayName" | "bio" | "stocks")[];
}) {
  const file = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const set = (p: Partial<ProfileDraft>) => setDraft({ ...draft, ...p });

  const onFile = async (f?: File) => {
    setUploadErr(null);
    if (!f) return;
    if (!f.type.startsWith("image/") || f.size > 8 * 1024 * 1024) return setUploadErr("choose an image under 8mb");
    try {
      const dataUrl = await resizeImage(f);
      const sb = getBrowserSupabase();
      if (sb) {
        // supabase storage: avatars/{user id}.jpg, public bucket with owner-only writes
        const blob = await (await fetch(dataUrl)).blob();
        const { error } = await sb.storage.from("avatars").upload(`${userId}.jpg`, blob, { upsert: true, contentType: "image/jpeg" });
        if (!error) { set({ avatar: sb.storage.from("avatars").getPublicUrl(`${userId}.jpg`).data.publicUrl }); return; }
      }
      set({ avatar: dataUrl });
    } catch { setUploadErr("couldn't read that image"); }
  };

  return (
    <div className="space-y-5">
      {fields.includes("avatar") && (
        <div>
          <p className="label">avatar</p>
          <div className="flex items-center gap-4">
            <Avatar user={{ ...draft, id: userId } as User} size={72} />
            <div className="flex gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={() => file.current?.click()}><Camera size={15} /> upload photo</button>
              {draft.avatar.startsWith("data:") || draft.avatar.startsWith("http") ? <button type="button" className="btn-ghost btn-sm" onClick={() => set({ avatar: "🧑‍🍳" })}>remove</button> : null}
            </div>
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {uploadErr && <p className="mt-1 text-sm text-loss">{uploadErr}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {AVATAR_EMOJIS.map((e) => <button type="button" key={e} onClick={() => set({ avatar: e })} className={cx("flex h-10 w-10 items-center justify-center rounded-full text-xl", draft.avatar === e ? "ring-2 ring-ink" : "bg-black/[.04]")} aria-label={`avatar ${e}`}>{e}</button>)}
          </div>
          <div className="mt-2 flex gap-1.5">
            {AVATAR_COLORS.map((c) => <button type="button" key={c} onClick={() => set({ avatarColor: c })} className={cx("h-8 w-8 rounded-full border", draft.avatarColor === c && "ring-2 ring-ink ring-offset-2")} style={{ background: c }} aria-label={`colour ${c}`} />)}
          </div>
        </div>
      )}
      {fields.includes("username") && (
        <div>
          <label className="label" htmlFor="username">username</label>
          <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
            <input id="username" className="input !pl-8" value={draft.username} maxLength={20} autoCapitalize="none" autoCorrect="off" onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "") })} />
          </div>
          <p className="mt-1 text-xs text-muted">3–20 characters. letters, numbers, dots and underscores.</p>
        </div>
      )}
      {fields.includes("displayName") && (
        <div>
          <label className="label" htmlFor="dn">display name</label>
          <input id="dn" className="input" value={draft.displayName} maxLength={30} onChange={(e) => set({ displayName: e.target.value })} />
        </div>
      )}
      {fields.includes("bio") && (
        <div>
          <label className="label" htmlFor="bio">bio</label>
          <textarea id="bio" className="input min-h-[84px] resize-none" value={draft.bio} maxLength={160} onChange={(e) => set({ bio: e.target.value })} placeholder="what's your investing style?" />
          <p className="num mt-1 text-right text-xs text-faint">{draft.bio.length}/160</p>
        </div>
      )}
      {fields.includes("stocks") && (
        <div>
          <p className="label">favourite stocks <span className="font-normal text-muted">(up to 5)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {ASSETS.map((a) => {
              const on = draft.favoriteStocks.includes(a.ticker);
              return (
                <button type="button" key={a.ticker} className={cx("chip", on && "chip-active")} aria-pressed={on}
                  onClick={() => set({ favoriteStocks: on ? draft.favoriteStocks.filter((t) => t !== a.ticker) : draft.favoriteStocks.length < 5 ? [...draft.favoriteStocks, a.ticker] : draft.favoriteStocks })}>
                  {a.ticker}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
