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
const C = { bg: "#F3F5FA", ink: "#0A1033", muted: "#5A6378", brand: "#1F3BFF", brandText: "#1F3BFF", gain: "#067049", loss: "#B92F36", line: "#D3D9E6", gold: "#A87012", slabText: "#FFFFFF", slabMuted: "#8B94B3", silver: "#B9C0CF" };

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** the app's own self-hosted faces (next/font exposes their family names as css variables) */
function family(v: "--font-display" | "--font-mono" | "--font-num" | "--font-ui") {
  const f = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : "";
  return `${f ? f + ", " : ""}system-ui, sans-serif`;
}
function font(weight: number, size: number, kind: "display" | "body" | "cond" | "mono" | "serif" = "display") {
  if (kind === "mono") return `${weight} ${size}px ${family("--font-num")}`;
  if (kind === "serif" || kind === "body") return `${weight} ${size}px ${family("--font-ui")}`;
  return `${kind === "cond" ? "italic " : ""}${weight} ${size}px ${family("--font-display")}`;
}
/** sets the font; condensed comes from fontStretch (the canvas font string can't carry it everywhere) */
function setF(ctx: CanvasRenderingContext2D, weight: number, size: number, kind: "display" | "body" | "cond" | "mono" | "serif" = "display") {
  ctx.font = font(weight, size, kind);
  (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = "normal";
}
function rule(ctx: CanvasRenderingContext2D, y: number, w = 4, color = C.ink) { ctx.fillStyle = color; ctx.fillRect(0, y, W, w); }

function brandHeader(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // the midnight bar with the wordmark: three speed stripes and a slanted BEEF
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, 190);
  ctx.fillStyle = C.brand; ctx.fillRect(0, 190, W, 8);
  ctx.save(); ctx.transform(1, 0, -0.36, 1, 0, 0);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = C.brand; ctx.fillRect(64 + 40 + i * 22, 62, 12, 70); }
  ctx.restore();
  ctx.fillStyle = C.slabText; setF(ctx, 900, 96, "cond"); ctx.textBaseline = "middle";
  ctx.fillText("BEEF", 164, 100);
  ctx.fillStyle = C.slabMuted; setF(ctx, 700, 24, "mono"); ctx.textAlign = "right";
  ctx.fillText("PUT YOUR MONEY WHERE YOUR MOUTH IS", W - 64, 100);
  ctx.textAlign = "left";
}

function footer(ctx: CanvasRenderingContext2D, date: string) {
  ctx.fillStyle = C.ink; ctx.fillRect(0, H - 112, W, 112);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.slabText; setF(ctx, 700, 24, "mono");
  ctx.fillText(date.toUpperCase(), 64, H - 70);
  ctx.textAlign = "right";
  ctx.fillText((typeof window !== "undefined" ? window.location.host : "beef").toUpperCase(), W - 64, H - 70);
  ctx.textAlign = "left";
  ctx.fillStyle = C.slabMuted; setF(ctx, 500, 18, "mono");
  ctx.fillText("PRICES: CHAINLINK DATA FEEDS · TEST USDC, NO REAL MONEY", 64, H - 36);
}

function stamp(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, color: string) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.09);
  setF(ctx, 900, 72, "cond"); const w = ctx.measureText(text).width + 52;
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(-w / 2, -50, w, 100);
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 0, 4);
  ctx.restore(); ctx.textAlign = "left";
}

export function drawTrophyCard(d: Duel, users: Record<string, User | undefined>): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  brandHeader(ctx);
  const st = d.settlement!;
  const draw = st.status === "draw";
  const winners = st.winners.map((w) => users[w]);
  const entries = [...st.entries].sort((a, b) => b.returnPct - a.returnPct).slice(0, 4);

  // headline, written from the result
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink; setF(ctx, 900, 118, "cond");
  ctx.fillText(draw ? "DEAD HEAT." : `${(winners[0]?.displayName.split(" ")[0] ?? "winner").toUpperCase()} ${st.winners.length > 1 ? "WIN" : "WINS"}.`, 64, 318);
  ctx.fillStyle = C.muted; setF(ctx, 500, 26, "mono");
  ctx.fillText(draw ? "IDENTICAL RETURNS · EVERY STAKE RETURNED" : `BY ${st.marginPct.toFixed(4)} PTS`, 64, 368);

  // the slab: one band per side, the winner's band in beef red
  const top = 410, bandH = Math.min(330, Math.floor((H - 112 - 40 - top) / entries.length));
  entries.forEach((e, i) => {
    const y = top + i * bandH;
    const won = !draw && st.winners.includes(e.userId);
    const home = d.participants[0]?.userId === e.userId;
    ctx.fillStyle = home ? C.brand : "#FFFFFF"; ctx.fillRect(0, y, W, bandH);
    if (i > 0) { ctx.fillStyle = C.ink; ctx.fillRect(0, y, W, 8); }
    ctx.save(); if (!won && !draw) ctx.globalAlpha = 0.55;
    // ticker as image, bleeding off the edge
    ctx.save(); ctx.globalAlpha *= 0.14; ctx.fillStyle = home ? "#FFFFFF" : C.ink; setF(ctx, 900, bandH * 1.3, "cond"); ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    ctx.beginPath(); ctx.rect(0, y, W, bandH); ctx.clip(); ctx.fillText(home ? "1" : "2", W - 20, y + bandH * 1.08); ctx.restore();
    const fg = home ? "#FFFFFF" : C.ink;
    ctx.fillStyle = fg; ctx.textBaseline = "alphabetic";
    setF(ctx, 700, 24, "mono"); ctx.fillText(`${home ? "HOME" : "AWAY"} · @${users[e.userId]?.username ?? "?"}`.toUpperCase() + (won ? " · W" : ""), 64, y + 52);
    setF(ctx, 900, 72, "cond"); ctx.fillText(e.ticker, 64, y + 122);
    if (!won && !draw) { const tw = ctx.measureText(e.ticker).width; ctx.fillRect(60, y + 96, tw + 8, 7); }
    setF(ctx, 900, bandH > 280 ? 178 : bandH > 200 ? 132 : 96, "cond"); ctx.textAlign = "right";
    ctx.fillText(pct(e.returnPct).replace("-", "−"), W - 64, y + bandH - 34);
    ctx.textAlign = "left";
    setF(ctx, 600, 22, "mono"); ctx.fillText(`$${e.startPrice.toFixed(2)} → $${e.endPrice.toFixed(2)}`, 64, y + bandH - 34);
    ctx.restore();
  });
  stamp(ctx, draw ? "DRAW" : "FINAL", W - 190, 296, draw ? C.ink : C.brand);
  footer(ctx, `${sessionLabel(st.startSession)} → ${sessionLabel(st.endSession)}`);
  return canvas;
}

export function drawPredictionCard(author: User | undefined, pick: string, versus: string, horizon: string, body: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  brandHeader(ctx);
  ctx.textAlign = "center"; ctx.fillStyle = C.muted; setF(ctx, 600, 28, "mono");
  ctx.fillText(`@${author?.username ?? "someone"} calls it`.toUpperCase(), W / 2, 340);
  ctx.fillStyle = C.ink; setF(ctx, 900, 230, "cond");
  ctx.fillText(pick, W / 2, 530);
  ctx.fillStyle = C.brandText; setF(ctx, 900, 72, "cond");
  ctx.fillText(`> ${versus}`, W / 2, 630);
  ctx.fillStyle = C.muted; setF(ctx, 500, 36);
  ctx.fillText(horizon, W / 2, 700);
  // quote
  ctx.fillStyle = C.ink; setF(ctx, 400, 40, "serif");
  const words = `“${body}”`.split(" ");
  let line = "", y = 820;
  for (const w of words) {
    if (ctx.measureText(line + w).width > W - 220) { ctx.fillText(line.trim(), W / 2, y); line = ""; y += 52; if (y > 1060) break; }
    line += w + " ";
  }
  if (y <= 1060) ctx.fillText(line.trim(), W / 2, y);
  ctx.fillStyle = C.ink; setF(ctx, 700, 34);
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
