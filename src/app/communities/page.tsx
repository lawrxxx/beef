"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { PageHeader } from "@/components/ui";
import { CommunityList } from "@/components/community-list";

export default function CommunitiesPage() {
  const s = useBeef();
  return (
    <div>
      <PageHeader title="communities" subtitle="find your people" action={<Link href="/communities/new" className="btn-dark btn-sm"><Plus size={16} /> create</Link>} />
      <CommunityList ids={s.communities.map((c) => c.id)} />
    </div>
  );
}
