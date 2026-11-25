"use client";

import Link from "next/link";
import { User as UserIcon } from "lucide-react";
import { useMe, useMounted } from "@/lib/hooks";
import { CardSkeleton, EmptyState } from "@/components/ui";
import { ProfileView } from "@/components/profile-view";

export default function MyProfilePage() {
  const me = useMe();
  const mounted = useMounted();
  if (!mounted) return <CardSkeleton />;
  if (!me) return <EmptyState icon={<UserIcon size={22} />} title="you're browsing as a guest" body="sign in to build your record, beef score and rivalries." action={<div className="flex gap-2"><Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link><Link href="/auth/sign-up" className="btn-outline btn-sm">create account</Link></div>} />;
  return <ProfileView user={me} />;
}
