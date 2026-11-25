"use client";

import { supabase } from "@/lib/store/store";

/** resizes an image to a 256px square jpeg blob */
async function resize(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const size = 256, c = document.createElement("canvas");
    c.width = c.height = size;
    const m = Math.min(img.width, img.height);
    c.getContext("2d")!.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("couldn't read that image"))), "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}

/** uploads to the public `avatars` bucket as {user id}.jpg (owner-only writes) and returns its url */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("choose an image under 8mb");
  const blob = await resize(file);
  const sb = await supabase();
  const path = `${userId}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(`couldn't upload your photo: ${error.message.toLowerCase()}`);
  return `${sb.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
}
