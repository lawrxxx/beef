"use client";

import Link from "next/link";
import { useBeef } from "@/lib/store/store";
import { cx } from "@/lib/format";

export function CommunityList({ ids }: { ids: string[] }) {
  const s = useBeef();
  return (
    <div className="grid border-t border-line sm:grid-cols-2 sm:gap-x-6">
      {ids.map((id) => {
        const c = s.communities.find((x) => x.id === id)!;
        const members = s.memberships.filter((m) => m.communityId === id).length;
        const joined = s.memberships.some((m) => m.communityId === id && m.userId === s.session.userId);
        return (
          <Link key={id} href={`/communities/${c.slug}`} className="flex items-center gap-3 border-b border-line py-3 hover:bg-ink/[.03]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-2xl">{c.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[17px] font-semibold tracking-[-0.02em]">{c.name}</p>
              <p className="text-[13px] text-muted">{members} members · {c.tickers.slice(0, 3).join(", ")}</p>
            </div>
            <span className={cx("text-[11px] font-semibold uppercase tracking-[.08em]", joined ? "text-gain" : "text-muted")}>{joined ? "joined" : "view"}</span>
          </Link>
        );
      })}
    </div>
  );
}
