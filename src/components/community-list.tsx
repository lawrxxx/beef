"use client";

import Link from "next/link";
import { useBeef } from "@/lib/store/store";
import { cx } from "@/lib/format";

export function CommunityList({ ids }: { ids: string[] }) {
  const s = useBeef();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ids.map((id) => {
        const c = s.communities.find((x) => x.id === id)!;
        const members = s.memberships.filter((m) => m.communityId === id).length;
        const joined = s.memberships.some((m) => m.communityId === id && m.userId === s.session.userId);
        return (
          <Link key={id} href={`/communities/${c.slug}`} className="card flex items-center gap-3 p-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink/[.04] text-2xl">{c.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{c.name}</p>
              <p className="text-[13px] text-muted">{members} members · {c.tickers.slice(0, 3).join(", ")}</p>
            </div>
            <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", joined ? "bg-gain-soft text-gain" : "bg-ink/[.05] text-muted")}>{joined ? "joined" : "view"}</span>
          </Link>
        );
      })}
    </div>
  );
}
