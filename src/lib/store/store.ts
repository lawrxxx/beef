"use client";

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, Comment, Community, DailyBeef, Duel, Notification, Post, ReactionKind, Reaction, User } from "@/lib/types";
import { DEFAULT_TERMS } from "@/lib/duel-terms";
import { getAsset } from "@/lib/market/assets";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// client store for beef. postgres (supabase) is the only source of truth: this holds
// what row level security lets the signed-in person see, writes actions back to the
// database, and reloads when realtime reports a change. there is no seeded or local data.

type Backend = typeof import("@/lib/backend/supabase");
let backendP: Promise<{ sb: SupabaseClient | null; be: Backend }> | null = null;
function backend() {
  return (backendP ??= Promise.all([import("@/lib/supabase/client"), import("@/lib/backend/supabase")])
    .then(([c, be]) => ({ sb: c.getBrowserSupabase(), be })));
}

/** false when the deployment has no supabase project configured (the app shows a setup screen) */
export const CONFIGURED = isSupabaseConfigured();

export interface SessionState {
  /** supabase auth user id (null when signed out) */
  userId: string | null;
  email?: string;
  /** a profile row exists (username chosen) */
  hasProfile: boolean;
  /** onboarding finished (or skipped past the optional wallet funding) */
  onboarded: boolean;
  ageConfirmed: boolean;
}

export interface BeefState {
  users: User[];
  duels: Duel[];
  posts: Post[];
  comments: Comment[];
  reactions: Reaction[];
  follows: { followerId: string; followeeId: string }[];
  communities: Community[];
  memberships: { communityId: string; userId: string }[];
  notifications: Notification[];
  daily: DailyBeef[];
  audit: Record<string, AuditLog[]>;
  session: SessionState;
  installDismissedAt?: number;
}

function emptyState(): BeefState {
  return {
    users: [], duels: [], posts: [], comments: [], reactions: [], follows: [], communities: [], memberships: [],
    notifications: [], daily: [], audit: {},
    session: { userId: null, hasProfile: false, onboarded: false, ageConfirmed: false },
  };
}

let state: BeefState = emptyState();
const serverState = state;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// ---------- loading ----------

let started = false;
let reloading: Promise<void> | null = null;

/** replaces local state with what the database says */
export function reloadRemote(): Promise<void> {
  if (!CONFIGURED) return Promise.resolve();
  if (reloading) return reloading;
  reloading = (async () => {
    try {
      const { sb, be } = await backend();
      if (!sb) return;
      const snap = await be.loadSnapshot(sb);
      state = {
        ...emptyState(), ...snap, installDismissedAt: state.installDismissedAt,
        session: {
          userId: snap.me?.id ?? null, email: snap.me?.email, hasProfile: !!snap.me?.hasProfile,
          onboarded: snap.me?.onboarded ?? false, ageConfirmed: snap.me?.adult ?? false,
        },
      };
    } catch (e) {
      remoteError(e);
    } finally {
      loaded = true;
      reloading = null;
      emit();
    }
  })();
  return reloading;
}

/** connects to the database once (called by <Boot>) */
export function loadPersisted() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!CONFIGURED) { loaded = true; emit(); return; }
  void (async () => {
    const { sb, be } = await backend();
    if (!sb) { loaded = true; emit(); return; }
    sb.auth.onAuthStateChange((event) => { if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED") void reloadRemote(); });
    be.subscribe(sb, () => void reloadRemote());
    await reloadRemote();
  })();
}

function remoteError(e: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("beef:toast", { detail: { kind: "error", text: e instanceof Error ? e.message : "couldn't save that" } }));
}

type Remote = Backend["remote"];
/** database write after an optimistic local update. on failure: toast + resync. */
function sync(fn: (sb: SupabaseClient, remote: Remote) => Promise<unknown>) {
  backend()
    .then(({ sb, be }) => (sb ? fn(sb, be.remote) : undefined))
    .catch((e) => { remoteError(e); void reloadRemote(); });
}
/** awaited write for actions whose result the ui waits on */
async function syncNow<T>(fn: (sb: SupabaseClient, remote: Remote) => Promise<T>): Promise<T> {
  const { sb, be } = await backend();
  if (!sb) throw new ActionError("beef isn't connected to its database");
  try { return await fn(sb, be.remote); } catch (e) { void reloadRemote(); throw new ActionError(e instanceof Error ? e.message : "couldn't save that"); }
}

/** the supabase browser client, for auth screens */
export async function supabase() {
  const { sb } = await backend();
  if (!sb) throw new ActionError("beef isn't connected to its database");
  return sb;
}

export function useStoreReady(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => loaded, () => false);
}

export const getState = () => state;

export function setState(fn: (s: BeefState) => BeefState) {
  state = fn(state);
  emit();
}

export function useBeef(): BeefState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => serverState);
}

// ---------- helpers ----------

const now = () => new Date().toISOString();
const me = () => state.session.userId;
const newId = () => crypto.randomUUID();

export class ActionError extends Error {}

function requireUser(): string {
  const id = me();
  if (!id) throw new ActionError("sign in to do that");
  if (!state.session.hasProfile) throw new ActionError("finish setting up your profile first");
  return id;
}

// client-side throttle (the server and database enforce their own limits too)
const lastAction = new Map<string, number[]>();
function throttle(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const arr = (lastAction.get(key) ?? []).filter((x) => t - x < windowMs);
  if (arr.length >= max) throw new ActionError("slow down a little, try again in a moment");
  arr.push(t);
  lastAction.set(key, arr);
}

// ---------- social actions ----------

export function createPost(input: { body: string; kind: Post["kind"]; prediction?: Post["prediction"]; duelId?: string; communityId?: string }) {
  const userId = requireUser();
  const body = input.body.trim();
  if (!body || body.length > 500) throw new ActionError("posts need 1–500 characters");
  throttle("post", 5, 60_000);
  const tickers = input.prediction ? [input.prediction.pick, input.prediction.versus] : Array.from(new Set((body.match(/\$?\b[A-Z]{2,5}\b/g) ?? []).map((x) => x.replace("$", "")).filter((t) => getAsset(t))));
  const post: Post = { id: newId(), authorId: userId, createdAt: now(), tickers, ...input, body };
  setState((s) => ({ ...s, posts: [post, ...s.posts] }));
  sync((sb, remote) => remote.createPost(sb, post));
  return post;
}

export function toggleReaction(targetType: "post" | "duel", targetId: string, kind: ReactionKind) {
  const userId = requireUser();
  setState((s) => {
    const existing = s.reactions.find((r) => r.targetType === targetType && r.targetId === targetId && r.userId === userId);
    let reactions = s.reactions.filter((r) => r !== existing);
    const next = !existing || existing.kind !== kind ? kind : null;
    if (next) reactions = [...reactions, { targetType, targetId, userId, kind }];
    sync((sb, remote) => remote.setReaction(sb, targetType, targetId, userId, next));
    return { ...s, reactions };
  });
}

export function addComment(targetType: "post" | "duel", targetId: string, body: string) {
  const userId = requireUser();
  const text = body.trim();
  if (!text || text.length > 300) throw new ActionError("comments need 1–300 characters");
  throttle("comment", 8, 60_000);
  const c: Comment = { id: newId(), targetType, targetId, authorId: userId, body: text, createdAt: now() };
  setState((s) => ({ ...s, comments: [...s.comments, c] }));
  sync((sb, remote) => remote.addComment(sb, c));
}

export function deleteComment(id: string) {
  const userId = requireUser();
  setState((s) => ({ ...s, comments: s.comments.filter((c) => !(c.id === id && c.authorId === userId)) }));
  sync((sb, remote) => remote.deleteComment(sb, id));
}

export function toggleFollow(followeeId: string) {
  const userId = requireUser();
  if (userId === followeeId) return;
  setState((s) => {
    const has = s.follows.some((f) => f.followerId === userId && f.followeeId === followeeId);
    sync((sb, remote) => remote.follow(sb, userId, followeeId, !has));
    return { ...s, follows: has ? s.follows.filter((f) => !(f.followerId === userId && f.followeeId === followeeId)) : [...s.follows, { followerId: userId, followeeId }] };
  });
}

export function toggleMembership(communityId: string) {
  const userId = requireUser();
  setState((s) => {
    const has = s.memberships.some((m) => m.communityId === communityId && m.userId === userId);
    sync((sb, remote) => remote.membership(sb, communityId, userId, !has));
    return { ...s, memberships: has ? s.memberships.filter((m) => !(m.communityId === communityId && m.userId === userId)) : [...s.memberships, { communityId, userId }] };
  });
}

export function createCommunity(input: { name: string; description: string; emoji: string; tickers: string[] }) {
  const userId = requireUser();
  const name = input.name.trim().toLowerCase();
  if (name.length < 3 || name.length > 40) throw new ActionError("names need 3–40 characters");
  const slug = name.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (state.communities.some((c) => c.slug === slug)) throw new ActionError("a community with that name already exists");
  const c: Community = { id: newId(), slug, name, description: input.description.trim().slice(0, 200), emoji: input.emoji || "💬", tickers: input.tickers, createdBy: userId, createdAt: now() };
  setState((s) => ({ ...s, communities: [...s.communities, c], memberships: [...s.memberships, { communityId: c.id, userId }] }));
  sync((sb, remote) => remote.createCommunity(sb, c));
  return c;
}

export function markAllRead() {
  const uidNow = me();
  if (uidNow) sync((sb, remote) => remote.markRead(sb, "all", uidNow));
  setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.userId === me() ? { ...n, read: true } : n)) }));
}

export function markRead(id: string) {
  const uidNow = me();
  if (uidNow) sync((sb, remote) => remote.markRead(sb, [id], uidNow));
  setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
}

export function pickDaily(session: string, ticker: string) {
  const userId = requireUser();
  if (state.daily.find((d) => d.session === session)?.picks[userId]) return;
  sync(async (sb, remote) => { const d = state.daily.find((x) => x.session === session); if (d) await remote.ensureDaily(sb, d); await remote.pickDaily(sb, session, userId, ticker); });
  setState((s) => ({ ...s, daily: s.daily.map((d) => (d.session === session && !d.picks[userId] ? { ...d, picks: { ...d.picks, [userId]: ticker } } : d)) }));
}

export function ensureDaily(entry: DailyBeef) {
  if (!loaded || state.daily.some((d) => d.session === entry.session)) return;
  setState((s) => ({ ...s, daily: [entry, ...s.daily] }));
}

// ---------- profile ----------

export const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

export async function usernameAvailable(username: string): Promise<boolean> {
  const un = username.trim().toLowerCase();
  if (!USERNAME_RE.test(un)) return false;
  return syncNow((sb, remote) => remote.usernameAvailable(sb, un));
}

/** first profile save during onboarding. the person chooses every value. */
export async function createProfile(p: { username: string; displayName: string; bio: string; avatar: string; avatarColor: string; referredBy?: string | null }) {
  const userId = me();
  if (!userId) throw new ActionError("sign in first");
  const username = p.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new ActionError("usernames are 3–20 characters: letters, numbers, dots, underscores");
  const displayName = p.displayName.trim();
  if (!displayName || displayName.length > 30) throw new ActionError("add a display name (up to 30 characters)");
  if (p.bio.length > 160) throw new ActionError("keep your bio under 160 characters");
  if (!(await usernameAvailable(username))) throw new ActionError("that username is taken");
  await syncNow((sb, remote) => remote.createProfile(sb, { id: userId, username, displayName, bio: p.bio.trim(), avatar: p.avatar, avatarColor: p.avatarColor, referredBy: p.referredBy ?? null }));
  await reloadRemote();
}

export async function updateProfile(patch: Partial<Pick<User, "username" | "displayName" | "bio" | "avatar" | "avatarColor" | "favoriteStocks">>) {
  const userId = requireUser();
  if (patch.username !== undefined) {
    const un = patch.username.trim().toLowerCase();
    const mine = state.users.find((u) => u.id === userId)?.username;
    if (!USERNAME_RE.test(un)) throw new ActionError("usernames are 3–20 characters: letters, numbers, dots, underscores");
    if (un !== mine && !(await usernameAvailable(un))) throw new ActionError("that username is taken");
    patch.username = un;
  }
  if (patch.displayName !== undefined && (!patch.displayName.trim() || patch.displayName.length > 30)) throw new ActionError("display names are 1–30 characters");
  if (patch.bio !== undefined && patch.bio.length > 160) throw new ActionError("keep your bio under 160 characters");
  await syncNow((sb, remote) => remote.updateProfile(sb, userId, patch));
  setState((s) => ({ ...s, users: s.users.map((x) => (x.id === userId ? { ...x, ...patch } : x)) }));
}

export async function completeOnboarding() {
  const userId = me();
  if (!userId) return;
  await syncNow((sb, remote) => remote.updateProfile(sb, userId, { onboarded: true, isAdult: true }));
  setState((s) => ({ ...s, session: { ...s.session, onboarded: true, ageConfirmed: true } }));
}

export async function signOut() {
  const { sb } = await backend();
  await sb?.auth.signOut();
  state = { ...emptyState(), installDismissedAt: state.installDismissedAt };
  emit();
  void reloadRemote(); // reload public content as a guest
}

export function dismissInstall() {
  setState((s) => ({ ...s, installDismissedAt: Date.now() }));
}

// ---------- duels ----------

export interface CreateDuelInput {
  myTicker: string;
  opponentTicker: string;
  opponentId: string | null; // null => open public challenge
  stake: number;
  deadline: string;
  deadlineLabel: string;
  visibility: Duel["visibility"];
  title?: string;
  communityId?: string;
  extra?: { userId: string; ticker: string }[]; // group beef
}

/** stakes in test usdc (the escrow caps them at 25) */
export const STAKE_OPTIONS = [1, 5, 10, 20, 25];
export const MAX_STAKE = 25;

/**
 * records the challenge in the database as unfunded. it only becomes a real duel once
 * the creator's stake is locked onchain (see the wallet flow); nobody can accept before.
 */
export async function createDuel(input: CreateDuelInput): Promise<Duel> {
  const userId = requireUser();
  throttle("duel", 4, 60_000);
  const tickers = [input.myTicker, input.opponentTicker, ...(input.extra ?? []).map((e) => e.ticker)];
  if (new Set(tickers).size !== tickers.length) throw new ActionError("each side needs a different stock");
  if (!STAKE_OPTIONS.includes(input.stake)) throw new ActionError("pick a stake from the list");
  if (new Date(input.deadline).getTime() <= Date.now()) throw new ActionError("the deadline must be in the future");
  if (tickers.some((t) => !getAsset(t))) throw new ActionError("pick supported stocks");
  if (input.opponentId === userId || (input.extra ?? []).some((e) => e.userId === userId)) throw new ActionError("you can't challenge yourself");
  if (input.opponentId && !state.users.some((u) => u.id === input.opponentId)) throw new ActionError("that person isn't on beef");
  if (input.extra && new Set([input.opponentId, ...input.extra.map((e) => e.userId)]).size !== input.extra.length + 1) throw new ActionError("each friend can only join once");
  const dupe = state.duels.find((d) => d.createdBy === userId && d.status === "pending" && d.escrowState === "unfunded"
    && d.participants[0]?.ticker === input.myTicker && d.participants[1]?.ticker === input.opponentTicker
    && (d.participants[1]?.userId || null) === (input.opponentId ?? null) && d.stake === input.stake);
  if (dupe) throw new ActionError("you already started this exact challenge. finish locking your stake on it.");
  const created = now();
  const duel: Duel = {
    id: newId(), createdBy: userId, createdAt: created,
    participants: [
      { userId, ticker: input.myTicker, accepted: true, acceptedAt: created },
      { userId: input.opponentId ?? "", ticker: input.opponentTicker, accepted: false },
      ...(input.extra ?? []).map((e) => ({ userId: e.userId, ticker: e.ticker, accepted: false })),
    ],
    stake: input.stake, visibility: input.visibility, open: input.opponentId === null,
    deadline: input.deadline, deadlineLabel: input.deadlineLabel,
    // matches the escrow's 2-day funding window
    inviteExpiresAt: new Date(Math.min(Date.now() + 47 * 3600e3, new Date(input.deadline).getTime() - 3600e3)).toISOString(),
    status: "pending", escrowState: "unfunded", startSnapshots: [], endSnapshots: [], title: input.title?.trim() || undefined,
    communityId: input.communityId, terms: { ...DEFAULT_TERMS },
  };
  await syncNow((sb, remote) => remote.createDuel(sb, duel));
  setState((s) => ({ ...s, duels: [duel, ...s.duels] }));
  return duel;
}

export async function declineDuel(id: string) {
  requireUser();
  await syncNow((sb, remote) => remote.rpc(sb, "decline_duel", id));
  await reloadRemote();
}

export async function cancelDuel(id: string) {
  const userId = requireUser();
  const d = state.duels.find((x) => x.id === id);
  if (!d || d.createdBy !== userId) throw new ActionError("only the creator can cancel");
  if (d.status !== "pending") throw new ActionError("only pending duels can be cancelled. once everyone's in, terms are locked.");
  await syncNow((sb, remote) => remote.rpc(sb, "cancel_duel", id));
  await reloadRemote();
}

/** duels link to their own page: invites live in the database */
export const inviteLink = (d: Duel) => `/duel/${d.id}`;

// ---------- server-driven transitions ----------

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ActionError(json.error ?? `request failed (${res.status})`);
  return json as T;
}

/** asks the server to lock starting prices (it loads the duel from the database) */
export async function requestLock(id: string) {
  const d = state.duels.find((x) => x.id === id);
  if (!d || d.status !== "accepted") return;
  const r = await post<{ ok: boolean; issues: string[] }>("/api/duels/lock", { duelId: id });
  if (!r.ok) throw new ActionError(r.issues.join("; ") || "prices are not ready to lock yet");
  await reloadRemote();
}

export async function requestSettlement(id: string) {
  const d = state.duels.find((x) => x.id === id);
  if (!d || !["active", "awaiting_verification"].includes(d.status)) return;
  if (d.settlement && d.settlement.status !== "needs_verification") return;
  const r = await post<{ outcome: string; reason?: string }>("/api/duels/settle", { duelId: id });
  if (r.outcome === "not_due") throw new ActionError("this duel hasn't reached its deadline close yet");
  if (r.outcome === "rejected") throw new ActionError(r.reason ?? "settlement rejected");
  await reloadRemote();
}

/** participants' browsers nudge due duels along (the server checks everything; cron covers the rest) */
export async function tickDuels() {
  const t = Date.now();
  for (const d of state.duels) {
    if (!d.participants.some((p) => p.userId === state.session.userId)) continue;
    try {
      if (d.status === "accepted" && d.lockAt && new Date(d.lockAt).getTime() <= t) await requestLock(d.id);
      else if (d.status === "active" && new Date(d.deadline).getTime() <= t) await requestSettlement(d.id);
    } catch { /* not ready yet; retried on the next tick */ }
  }
}
