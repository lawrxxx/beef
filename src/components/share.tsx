"use client";

import type { Duel, User } from "@/lib/types";
import { pct, sessionLabel } from "@/lib/format";

export function toast(kind: "success" | "error" | "info", text: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("beef:toast", { detail: { kind, text } }));
}

export function absoluteUrl(path: string) {
  const base = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL ?? "";
  return base + path;
}

/** native share sheet where available, clipboard otherwise */
export async function shareLink(path: string, text: string, title = "beef") {
  const url = path.startsWith("http") ? path : absoluteUrl(path);
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("success", "link copied");
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    try { await navigator.clipboard.writeText(url); toast("success", "link copied"); }
    catch { toast("error", "couldn't share. copy the address bar instead."); }
  }
}

// ---------- image cards ----------

const W = 1080, H = 1350;
const C = { bg: "#F6F5F2", ink: "#1D1D1F", muted: "#6E6E73", brand: "#E5552C", gain: "#11915A", loss: "#D33F49", line: "#E7E5E0", gold: "#B7871C" };

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function font(weight: number, size: number) {
  return `${weight} ${size}px ui-rounded, -apple-system, "SF Pro Rounded", Inter, system-ui, sans-serif`;
}

function brandHeader(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // logo
  ctx.fillStyle = C.brand; rr(ctx, 80, 80, 84, 84, 24); ctx.fill();
  ctx.fillStyle = "#fff"; rr(ctx, 96, 98, 40, 30, 8); ctx.fill();
  ctx.fillStyle = C.ink; rr(ctx, 116, 118, 34, 26, 7); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = font(800, 56); ctx.textBaseline = "middle";
  ctx.fillText("beef", 186, 124);
  ctx.fillStyle = C.muted; ctx.font = font(500, 28); ctx.textAlign = "right";
  ctx.fillText("put your money where your mouth is", W - 80, 124);
  ctx.textAlign = "left";
}

function footer(ctx: CanvasRenderingContext2D, date: string) {
  ctx.fillStyle = C.muted; ctx.font = font(500, 28);
  ctx.fillText(date, 80, H - 120);
  ctx.textAlign = "right";
  ctx.fillText(typeof window !== "undefined" ? window.location.host : "beef", W - 80, H - 120);
  ctx.textAlign = "left";
  ctx.fillStyle = C.gold; ctx.font = font(600, 24);
  ctx.fillText("prices: chainlink data streams · test usdc, no real money", 80, H - 76);
}

export function drawTrophyCard(d: Duel, users: Record<string, User | undefined>): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  brandHeader(ctx);
  const st = d.settlement!;
  const draw = st.status === "draw";
  const winners = st.winners.map((w) => users[w]);
  const entries = st.entries;

  ctx.font = "120px serif"; ctx.textAlign = "center";
  ctx.fillText(draw ? "🤝" : "🏆", W / 2, 330);
  ctx.fillStyle = C.ink; ctx.font = font(800, 76);
  const headline = draw ? "dead heat" : `@${winners[0]?.username ?? "winner"} wins`;
  ctx.fillText(headline, W / 2, 470);
  ctx.fillStyle = C.muted; ctx.font = font(500, 36);
  const others = entries.filter((e) => !st.winners.includes(e.userId)).map((e) => `@${users[e.userId]?.username}`);
  ctx.fillText(draw ? "identical returns, stakes returned" : `beat ${others.slice(0, 2).join(", ")}${others.length > 2 ? " +" + (others.length - 2) : ""}`, W / 2, 530);
  ctx.textAlign = "left";

  // rows
  const top = 610, rowH = entries.length > 2 ? 120 : 150;
  entries.slice(0, 4).forEach((e, i) => {
    const y = top + i * (rowH + 20);
    ctx.fillStyle = "#fff"; rr(ctx, 80, y, W - 160, rowH, 32); ctx.fill();
    ctx.strokeStyle = st.winners.includes(e.userId) ? C.ink : C.line; ctx.lineWidth = st.winners.includes(e.userId) ? 4 : 2; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = font(800, 54); ctx.textBaseline = "middle";
    ctx.fillText(e.ticker, 120, y + rowH / 2 - 14);
    ctx.fillStyle = C.muted; ctx.font = font(500, 28);
    ctx.fillText(`@${users[e.userId]?.username ?? "?"} · $${e.startPrice.toFixed(2)} → $${e.endPrice.toFixed(2)}`, 120, y + rowH / 2 + 32);
    ctx.textAlign = "right";
    ctx.fillStyle = e.returnPct > 0 ? C.gain : e.returnPct < 0 ? C.loss : C.muted; ctx.font = font(800, 60);
    ctx.fillText(pct(e.returnPct), W - 120, y + rowH / 2);
    ctx.textAlign = "left";
  });

  const shown = Math.min(entries.length, 4);
  ctx.fillStyle = C.ink; ctx.font = font(600, 34); ctx.textAlign = "center";
  const by = top + shown * (rowH + 20) + 50;
  ctx.fillText(draw ? "identical percentage returns" : `won by ${st.marginPct.toFixed(2)} percentage points`, W / 2, by);
  ctx.fillStyle = C.muted; ctx.font = font(500, 26);
  ctx.fillText("return = (end − start) ÷ start. share price doesn't matter.", W / 2, by + 48);
  ctx.textAlign = "left";
  footer(ctx, `${sessionLabel(st.startSession)} → ${sessionLabel(st.endSession)}`);
  return canvas;
}

export function drawPredictionCard(author: User | undefined, pick: string, versus: string, horizon: string, body: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  brandHeader(ctx);
  ctx.textAlign = "center"; ctx.fillStyle = C.muted; ctx.font = font(600, 36);
  ctx.fillText(`@${author?.username ?? "someone"} predicts`, W / 2, 340);
  ctx.fillStyle = C.ink; ctx.font = font(900, 150);
  ctx.fillText(pick, W / 2, 520);
  ctx.fillStyle = C.brand; ctx.font = font(800, 52);
  ctx.fillText(`beats ${versus}`, W / 2, 630);
  ctx.fillStyle = C.muted; ctx.font = font(500, 36);
  ctx.fillText(horizon, W / 2, 700);
  // quote
  ctx.fillStyle = C.ink; ctx.font = font(500, 36);
  const words = `“${body}”`.split(" ");
  let line = "", y = 820;
  for (const w of words) {
    if (ctx.measureText(line + w).width > W - 220) { ctx.fillText(line.trim(), W / 2, y); line = ""; y += 52; if (y > 1060) break; }
    line += w + " ";
  }
  if (y <= 1060) ctx.fillText(line.trim(), W / 2, y);
  ctx.fillStyle = C.ink; ctx.font = font(700, 34);
  ctx.fillText("think they're wrong? challenge them on beef.", W / 2, H - 220);
  ctx.textAlign = "left";
  footer(ctx, new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toLowerCase());
  return canvas;
}

/** shares the image via the native share sheet (whatsapp, instagram stories, x…) or downloads it */
export async function shareCanvas(canvas: HTMLCanvasElement, filename: string, text: string, path: string) {
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return toast("error", "couldn't create the image");
  const file = new File([blob], filename, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${absoluteUrl(path)}`, title: "beef" });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("success", "image saved");
}
