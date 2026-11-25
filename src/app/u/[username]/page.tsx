"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { UserX } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { useMounted } from "@/lib/hooks";
import { CardSkeleton, EmptyState } from "@/components/ui";
import { ProfileView } from "@/components/profile-view";

export default function UserPage() {
  const { username } = useParams<{ username: string }>();
  const s = useBeef();
  const mounted = useMounted();
  const user = s.users.find((u) => u.username === decodeURIComponent(username).toLowerCase());
  if (!mounted) return <CardSkeleton />;
  if (!user) return <EmptyState icon={<UserX size={22} />} title="user not found" body={`there's no one called @${username} on beef.`} action={<Link href="/discover" className="btn-dark btn-sm">find people</Link>} />;
  return <ProfileView user={user} />;
}
