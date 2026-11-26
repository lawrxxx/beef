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
const C = { bg: "#F2EDE3", ink: "#1C1915", muted: "#70685C", brand: "#CD421C", brandText: "#AC3414", gain: "#2E6E4C", loss: "#8A3448", line: "#DCD3C4", gold: "#866019" };

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
function family(v: "--font-display" | "--font-body") {
  const f = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : "";
  return `${f ? f + ", " : ""}system-ui, sans-serif`;
}
function font(weight: number, size: number, kind: "display" | "body" | "cond" = "display") {
  const stretch = kind === "cond" ? "condensed " : "";
  return `${stretch}${weight} ${size}px ${family(kind === "body" ? "--font-body" : "--font-display")}`;
}
function rule(ctx: CanvasRenderingContext2D, y: number, w = 3, color = C.ink) { ctx.fillStyle = color; ctx.fillRect(80, y, W - 160, w); }

function brandHeader(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.brand; rr(ctx, 80, 80, 84, 84, 18); ctx.fill();
  ctx.fillStyle = "#FAF7F1"; rr(ctx, 96, 98, 40, 30, 8); ctx.fill();
  ctx.fillStyle = C.ink; rr(ctx, 116, 118, 34, 26, 7); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = font(800, 60); ctx.textBaseline = "middle";
  ctx.fillText("beef", 184, 122);
  ctx.fillStyle = C.muted; ctx.font = font(500, 26, "body"); ctx.textAlign = "right";
  ctx.fillText("put your money where your mouth is.", W - 80, 124);
  ctx.textAlign = "left";
  rule(ctx, 204);
}

function footer(ctx: CanvasRenderingContext2D, date: string) {
  rule(ctx, H - 170, 2);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.muted; ctx.font = font(500, 26, "body");
  ctx.fillText(date, 80, H - 112);
  ctx.textAlign = "right";
  ctx.fillText(typeof window !== "undefined" ? window.location.host : "beef", W - 80, H - 112);
  ctx.textAlign = "left";
  ctx.fillStyle = C.gold; ctx.font = font(600, 22, "body");
  ctx.fillText("prices: chainlink data feeds · test usdc, no real money", 80, H - 72);
}

function stamp(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, color: string) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.07);
  ctx.font = font(800, 64, "cond"); const w = ctx.measureText(text).width + 56;
  ctx.strokeStyle = color; ctx.lineWidth = 7; rr(ctx, -w / 2, -48, w, 96, 8); ctx.stroke();
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
  const entries = [...st.entries].sort((a, b) => b.returnPct - a.returnPct);

  // headline
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.brandText; ctx.font = font(700, 26, "cond");
  ctx.fillText(draw ? "DEAD HEAT" : "RESULT", 80, 290);
  ctx.fillStyle = C.ink; ctx.font = font(800, draw ? 104 : 96);
  ctx.fillText(draw ? "dead heat." : `@${winners[0]?.username ?? "winner"}`, 80, 400);
  if (!draw) ctx.fillText(st.winners.length > 1 ? "win." : "wins.", 80, 500);
  stamp(ctx, draw ? "DRAW" : "WON", W - 210, draw ? 360 : 440, draw ? C.ink : C.brand);
  ctx.fillStyle = C.muted; ctx.font = font(500, 32, "body");
  const others = entries.filter((e) => !st.winners.includes(e.userId)).map((e) => `@${users[e.userId]?.username}`);
  ctx.fillText(draw ? "identical returns, every stake returned" : `beat ${others.slice(0, 2).join(", ")}${others.length > 2 ? " +" + (others.length - 2) : ""}`, 80, draw ? 470 : 565);

  // scoreboard rows
  const top = 640, rowH = entries.length > 2 ? 118 : 150;
  rule(ctx, top - 20, 3);
  entries.slice(0, 4).forEach((e, i) => {
    const y = top + i * rowH;
    const won = st.winners.includes(e.userId);
    if (won && !draw) { ctx.fillStyle = C.brand; ctx.fillRect(80, y + 14, 8, rowH - 28); }
    ctx.textBaseline = "middle";
    ctx.fillStyle = won ? C.ink : C.muted; ctx.font = font(800, 76, "cond");
    ctx.fillText(e.ticker, 112, y + rowH / 2 - 14);
    ctx.fillStyle = C.muted; ctx.font = font(500, 26, "body");
    ctx.fillText(`@${users[e.userId]?.username ?? "?"} · $${e.startPrice.toFixed(2)} → $${e.endPrice.toFixed(2)}`, 114, y + rowH / 2 + 36);
    ctx.textAlign = "right";
    ctx.fillStyle = e.returnPct > 0 ? C.gain : e.returnPct < 0 ? C.loss : C.muted; ctx.font = font(800, 84, "cond");
    ctx.fillText(pct(e.returnPct), W - 80, y + rowH / 2);
    ctx.textAlign = "left";
    rule(ctx, y + rowH - 1, 2, C.line);
  });

  const shown = Math.min(entries.length, 4);
  const by = top + shown * rowH + 70;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink; ctx.font = font(700, 36);
  ctx.fillText(draw ? "identical percentage returns" : `won by ${st.marginPct.toFixed(2)} percentage points`, 80, by);
  ctx.fillStyle = C.muted; ctx.font = font(500, 24, "body");
  ctx.fillText("return = (end − start) ÷ start. share price doesn't matter.", 80, by + 44);
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
  ctx.fillStyle = C.ink; ctx.font = font(800, 210, "cond");
  ctx.fillText(pick, W / 2, 530);
  ctx.fillStyle = C.brandText; ctx.font = font(700, 52);
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
