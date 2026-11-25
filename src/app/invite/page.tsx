"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Swords } from "lucide-react";
import { importInvite, loadPersisted } from "@/lib/store/store";
import { CardSkeleton, EmptyState } from "@/components/ui";

/** invitation links carry the challenge terms in the url fragment (never sent to the server) */
export default function InvitePage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadPersisted();
    const code = window.location.hash.slice(1);
    const id = code ? importInvite(code) : null;
    if (id) router.replace(`/duel/${id}`);
    else setFailed(true);
  }, [router]);
  if (failed) return <EmptyState icon={<Swords size={22} />} title="this invite link doesn't work" body="it may be incomplete. ask your friend to share it again." action={<Link href="/" className="btn-dark btn-sm">go home</Link>} />;
  return <CardSkeleton />;
}
