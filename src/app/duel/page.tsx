"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Plus, Swords } from "lucide-react";
import type { Duel } from "@/lib/types";
import { useBeef } from "@/lib/store/store";
import { useMe, useMounted } from "@/lib/hooks";
import { canAccept, isParticipant } from "@/lib/derive";
import { CardSkeleton, EmptyState, PageHeader, SimBadge, Tabs } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";

type Tab = "mine" | "live" | "open" | "settled";

function DuelsInner() {
  const s = useBeef();
  const me = useMe();
  const mounted = useMounted();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || (me ? "mine" : "live"));

  const lists = useMemo(() => {
    const byRecent = (a: Duel, b: Duel) => b.createdAt.localeCompare(a.createdAt);
    const mine = s.duels.filter((d) => isParticipant(d, me?.id ?? null)).sort(byRecent);
    return {
      mine,
      live: s.duels.filter((d) => d.status === "active" && d.visibility === "public").sort((a, b) => a.deadline.localeCompare(b.deadline)),
      open: s.duels.filter((d) => d.status === "pending" && (d.open || canAccept(d, me?.id ?? null))).sort(byRecent),
      settled: s.duels.filter((d) => d.status === "completed" || d.status === "awaiting_verification").sort((a, b) => b.deadline.localeCompare(a.deadline)),
    };
  }, [s.duels, me?.id]);

  const groups: { title: string; list: Duel[] }[] = tab === "mine"
    ? [
        { title: "needs your answer", list: lists.mine.filter((d) => canAccept(d, me?.id ?? null)) },
        { title: "live", list: lists.mine.filter((d) => ["active", "accepted"].includes(d.status)) },
        { title: "waiting", list: lists.mine.filter((d) => d.status === "pending" && !canAccept(d, me?.id ?? null)) },
        { title: "settled", list: lists.mine.filter((d) => ["completed", "awaiting_verification"].includes(d.status)) },
        { title: "closed", list: lists.mine.filter((d) => ["cancelled", "declined", "expired"].includes(d.status)) },
      ]
    : [{ title: "", list: lists[tab] }];

  return (
    <div>
      <PageHeader
        title="duels"
        subtitle="every beef, in one place"
        action={<Link href="/duel/new" className="btn-primary btn-sm"><Plus size={16} /> new</Link>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} className="mb-4" options={[
        ...(me ? [{ value: "mine" as Tab, label: "my duels" }] : []),
        { value: "live", label: "live" }, { value: "open", label: "open challenges" }, { value: "settled", label: "settled" },
      ]} />
      {!mounted ? <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div> : groups.every((g) => g.list.length === 0) ? (
        <EmptyState icon={<Swords size={22} />} title="no duels here yet" body="start one: pick two stocks and a friend." action={<Link href="/duel/new" className="btn-primary btn-sm">start a beef</Link>} />
      ) : (
        groups.filter((g) => g.list.length).map((g) => (
          <section key={g.title} className="mb-6">
            {g.title && <h2 className="section-title mb-2">{g.title} · {g.list.length}</h2>}
            <div className="grid gap-3 sm:grid-cols-2">{g.list.map((d) => <DuelCard key={d.id} d={d} />)}</div>
          </section>
        ))
      )}
      <div className="mt-4 flex justify-center"><SimBadge label="staked in test usdc on base sepolia" /></div>
    </div>
  );
}

export default function DuelsPage() {
  return <Suspense><DuelsInner /></Suspense>;
}
