"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Image as ImageIcon, MessageCircle } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { useMounted, userById } from "@/lib/hooks";
import { CardSkeleton, EmptyState } from "@/components/ui";
import { Comments, PostCard } from "@/components/social";
import { drawPredictionCard, shareCanvas } from "@/components/share";

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const s = useBeef();
  const router = useRouter();
  const mounted = useMounted();
  const post = s.posts.find((p) => p.id === id);
  if (!mounted) return <CardSkeleton />;
  if (!post) return <EmptyState icon={<MessageCircle size={22} />} title="post not found" action={<Link href="/" className="btn-dark btn-sm">home</Link>} />;
  const author = userById(s, post.authorId);
  return (
    <div>
      <button className="btn-ghost btn-sm -ml-2 mb-2 !px-2" onClick={() => router.back()}><ArrowLeft size={18} /> back</button>
      <PostCard post={post} />
      {post.prediction && (
        <button className="btn-outline btn-sm mt-3 w-full" onClick={() => shareCanvas(drawPredictionCard(author, post.prediction!.pick, post.prediction!.versus, post.prediction!.horizon, post.body), `beef-prediction-${post.id}.png`, `${post.prediction!.pick} beats ${post.prediction!.versus} ${post.prediction!.horizon}?`, `/post/${post.id}`)}>
          <ImageIcon size={15} /> share as prediction card
        </button>
      )}
      <div id="comments" className="card mt-3 p-4">
        <h2 className="section-title">comments</h2>
        <Comments targetType="post" targetId={post.id} />
      </div>
    </div>
  );
}
