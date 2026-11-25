"use client";

import { useSyncExternalStore } from "react";
import type {
  AuditLog, Comment, Community, DailyBeef, Duel, Notification, Post, PriceSnapshot, Reaction,
  ReactionKind, Settlement, SimTransaction, User,
} from "@/lib/types";
import {
  ME, seedComments, seedCommunities, seedDaily, seedDuels, seedFollows, seedMemberships,
  seedNotifications, seedPosts, seedReactions, seedTransactions, seedUsers, DEFAULT_TERMS,
} from "@/data/seed";
import { uid } from "@/lib/format";
import { getAsset } from "@/lib/market/assets";
import { nextCloseAfter, sessionCloseUtc } from "@/lib/market/calendar";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { SupabaseClient } from "@supabase/supabase-js";

// the supabase client and data layer are loaded on demand, so demo deployments never
// download them
type Backend = typeof import("@/lib/backend/supabase");
let backendP: Promise<{ sb: SupabaseClient | null; be: Backend }> | null = null;
function backend() {
  return (backendP ??= Promise.all([import("@/lib/supabase/client"), import("@/lib/backend/supabase")])
    .then(([c, be]) => ({ sb: c.getBrowserSupabase(), be })));
}

/** supabase mode: data lives in postgres. demo mode: seeded data in localStorage. */
export const REMOTE = isSupabaseConfigured();

export interface SessionState {
  userId: string | null;
  email?: string;
  onboarded: boolean;
  ageConfirmed: boolean;
  mode: "demo" | "supabase";
}

export interface BeefState {
  version: number;
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
  transactions: SimTransaction[];
  audit: Record<string, AuditLog[]>;
  session: SessionState;
  installDismissedAt?: number;
}

const VERSION = 4;
const KEY = "beef:demo:v4";

function seedState(): BeefState {
  return {
    version: VERSION,
    users: seedUsers, duels: seedDuels, posts: seedPosts, comments: seedComments, reactions: seedReactions,
    follows: seedFollows, communities: seedCommunities, memberships: seedMemberships,
    notifications: seedNotifications, daily: seedDaily, transactions: seedTransactions, audit: {},
    session: { userId: ME, onboarded: true, ageConfirmed: true, mode: "demo" },
  };
}

function emptyState(): BeefState {
  return {
    version: VERSION, users: [], duels: [], posts: [], comments: [], reactions: [], follows: [], communities: [],
    memberships: [], notifications: [], daily: [], transactions: [], audit: {},
    session: { userId: null, onboarded: false, ageConfirmed: false, mode: "supabase" },
  };
}

let state: BeefState = REMOTE ? emptyState() : seedState();
const serverState = state;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (REMOTE) return; // postgres is the source of truth
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
}

export function loadPersisted() {
  if (loaded || typeof window === "undefined") return;
  if (REMOTE) { void startRemote(); return; }
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BeefState;
      if (parsed.version === VERSION) {
        state = parsed;
      }
    }
  } catch {
    /* corrupt storage – fall back to seed */
  }
  emit();
}

// ---------- supabase mode ----------

let remoteStarted = false;
let reloading: Promise<void> | null = null;

/** replaces local state with what the database says (rls decides what we can see) */
export function reloadRemote(): Promise<void> {
  if (!REMOTE) return Promise.resolve();
  if (reloading) return reloading;
  reloading = (async () => {
    try {
      const { sb, be } = await backend();
      if (!sb) return;
      const snap = await be.loadSnapshot(sb);
      const prevDismissed = state.installDismissedAt;
      state = {
        ...emptyState(), ...snap, installDismissedAt: prevDismissed,
        transactions: snap.me ? [{ id: "sim_faucet", userId: snap.me.id, kind: "faucet", amount: 100, createdAt: snap.users.find((u) => u.id === snap.me!.id)?.joinedAt ?? now(), state: "simulated" }] : [],
        session: { userId: snap.me?.id ?? null, email: snap.me?.email, onboarded: snap.me?.onboarded ?? false, ageConfirmed: snap.me?.adult ?? false, mode: "supabase" },
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

async function startRemote() {
  if (remoteStarted) return;
  remoteStarted = true;
  const { sb, be } = await backend();
  if (!sb) return;
  sb.auth.onAuthStateChange((event) => { if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED") void reloadRemote(); });
  be.subscribe(sb, () => void reloadRemote());
  await reloadRemote();
}

function remoteError(e: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("beef:toast", { detail: { kind: "error", text: e instanceof Error ? e.message : "couldn't save that" } }));
}

/** runs a database write after an optimistic local update. on failure: toast + resync. */
type Remote = Backend["remote"];
function sync(fn: (sb: SupabaseClient, remote: Remote) => Promise<unknown>) {
  if (!REMOTE) return;
  backend()
    .then(({ sb, be }) => (sb ? fn(sb, be.remote) : undefined))
    .catch((e) => { remoteError(e); void reloadRemote(); });
}

/** awaited variant for actions whose result the ui waits on */
async function syncNow(fn: (sb: SupabaseClient, remote: Remote) => Promise<unknown>) {
  const { sb, be } = await backend();
  if (!sb) return;
  try { await fn(sb, be.remote); } catch (e) { void reloadRemote(); throw new ActionError(e instanceof Error ? e.message : "couldn't save that"); }
}

/** ids: uuids in supabase mode (database primary keys), short ids in demo mode */
const newId = (prefix: string) => (REMOTE ? crypto.randomUUID() : uid(prefix));

/** true once saved data (if any) has been loaded. pages render after this, so the
 *  seed never flashes before a returning user's data, and nothing time-dependent is
 *  rendered on the server. */
export function useStoreReady(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => loaded,
    () => false,
  );
}

export function getState() {
  return state;
}

export function setState(fn: (s: BeefState) => BeefState) {
  // child effects can fire before <Boot> loads storage; load first so a write never
  // overwrites a returning user's saved data with the seed
  if (!loaded) loadPersisted();
  state = fn(state);
  persist();
  emit();
}

export function useBeef(): BeefState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => serverState,
  );
}

export function resetDemo() {
  if (REMOTE) return;
  state = seedState();
  persist();
  emit();
}

// ---------- helpers ----------

const now = () => new Date().toISOString();
const me = () => state.session.userId;

function notify(n: Omit<Notification, "id" | "createdAt" | "read" | "userId">, userId = ME) {
  // demo mode only: in supabase mode the database creates notifications (triggers)
  if (REMOTE || userId !== ME) return [] as Notification[];
  return [{ ...n, id: uid("n"), userId, createdAt: now(), read: false }];
}

export class ActionError extends Error {}

function requireUser(): string {
  const id = me();
  if (!id) throw new ActionError("sign in to do that");
  return id;
}

// simple client-side throttle for spammy actions (server routes rate limit too)
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
  const tickers = input.prediction ? [input.prediction.pick, input.prediction.versus] : Array.from(new Set((body.match(/\$?\b[A-Z]{2,5}\b/g) ?? []).map((x) => x.replace("$", ""))));
  const post: Post = { id: newId("p"), authorId: userId, createdAt: now(), tickers, ...input, body };
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
  const c: Comment = { id: newId("cm"), targetType, targetId, authorId: userId, body: text, createdAt: now() };
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
    return {
      ...s,
      follows: has
        ? s.follows.filter((f) => !(f.followerId === userId && f.followeeId === followeeId))
        : [...s.follows, { followerId: userId, followeeId }],
    };
  });
}

export function toggleMembership(communityId: string) {
  const userId = requireUser();
  setState((s) => {
    const has = s.memberships.some((m) => m.communityId === communityId && m.userId === userId);
    sync((sb, remote) => remote.membership(sb, communityId, userId, !has));
    return {
      ...s,
      memberships: has
        ? s.memberships.filter((m) => !(m.communityId === communityId && m.userId === userId))
        : [...s.memberships, { communityId, userId }],
    };
  });
}

export function createCommunity(input: { name: string; description: string; emoji: string; tickers: string[] }) {
  const userId = requireUser();
  const name = input.name.trim().toLowerCase();
  if (name.length < 3 || name.length > 40) throw new ActionError("names need 3–40 characters");
  const slug = name.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (state.communities.some((c) => c.slug === slug)) throw new ActionError("a community with that name already exists");
  const c: Community = { id: newId("c"), slug, name, description: input.description.trim().slice(0, 200), emoji: input.emoji || "💬", tickers: input.tickers, createdBy: userId, createdAt: now() };
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
  setState((s) => ({
    ...s,
    daily: s.daily.map((d) => (d.session === session && !d.picks[userId] ? { ...d, picks: { ...d.picks, [userId]: ticker } } : d)),
  }));
}

export function ensureDaily(entry: DailyBeef) {
  if (REMOTE && !loaded) return;
  if (state.daily.some((d) => d.session === entry.session)) return;
  setState((s) => ({ ...s, daily: [entry, ...s.daily] }));
}

export function updateProfile(patch: Partial<Pick<User, "username" | "displayName" | "bio" | "avatar" | "avatarColor" | "favoriteStocks">>) {
  const userId = requireUser();
  if (patch.username !== undefined) {
    const un = patch.username.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,20}$/.test(un)) throw new ActionError("usernames are 3–20 characters: letters, numbers, dots, underscores");
    if (state.users.some((x) => x.username === un && x.id !== userId)) throw new ActionError("that username is taken");
    patch.username = un;
  }
  if (patch.bio !== undefined && patch.bio.length > 160) throw new ActionError("keep your bio under 160 characters");
  setState((s) => ({ ...s, users: s.users.map((x) => (x.id === userId ? { ...x, ...patch } : x)) }));
  sync((sb, remote) => remote.updateProfile(sb, userId, patch));
}

// ---------- session ----------

export function signInDemo(email?: string) {
  setState((s) => ({ ...s, session: { ...s.session, userId: ME, email, onboarded: true, ageConfirmed: true } }));
}

export function signUpDemo(email: string) {
  setState((s) => ({ ...s, session: { ...s.session, userId: ME, email, onboarded: false, ageConfirmed: false } }));
}

export function completeOnboarding(country?: string) {
  const userId = me();
  if (userId) sync((sb, remote) => remote.updateProfile(sb, userId, { onboarded: true, isAdult: true, country }));
  setState((s) => ({ ...s, session: { ...s.session, onboarded: true, ageConfirmed: true } }));
}

export function signOut() {
  if (REMOTE) void backend().then(({ sb }) => sb?.auth.signOut());
  setState((s) => ({ ...s, session: { ...s.session, userId: null, email: undefined } }));
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

export const STAKE_OPTIONS = [1, 5, 10, 20, 25];
export const MAX_STAKE = 25;

export function practiceBalance(s: BeefState, userId = ME): number {
  let bal = s.transactions.filter((t) => t.userId === userId).reduce((a, t) => a + t.amount, 0);
  for (const d of s.duels) {
    const p = d.participants.find((x) => x.userId === userId);
    if (!p || !p.accepted) continue;
    if (["accepted", "active", "awaiting_verification", "completed", "pending"].includes(d.status)) bal -= d.stake;
    if (d.status === "completed" && d.settlement) {
      if (d.settlement.status === "draw") bal += d.stake;
      else if (d.settlement.winners.includes(userId)) bal += (d.stake * d.participants.length) / d.settlement.winners.length;
    }
    if (["cancelled", "expired", "declined"].includes(d.status)) { /* never locked */ }
  }
  return Math.round(bal * 100) / 100;
}

export async function createDuel(input: CreateDuelInput): Promise<Duel> {
  const userId = requireUser();
  if (!state.session.ageConfirmed) throw new ActionError("confirm you're 18+ in onboarding first");
  throttle("duel", 4, 60_000);
  const tickers = [input.myTicker, input.opponentTicker, ...(input.extra ?? []).map((e) => e.ticker)];
  if (new Set(tickers).size !== tickers.length) throw new ActionError("each side needs a different stock");
  if (!STAKE_OPTIONS.includes(input.stake) || input.stake > MAX_STAKE) throw new ActionError("pick a stake from the list");
  if (input.stake > practiceBalance(state, userId)) throw new ActionError("not enough practice balance for this stake");
  if (new Date(input.deadline).getTime() <= Date.now()) throw new ActionError("the deadline must be in the future");
  if (!getAsset(input.myTicker) || !getAsset(input.opponentTicker) || (input.extra ?? []).some((e) => !getAsset(e.ticker))) throw new ActionError("pick supported stocks");
  if (input.opponentId === userId || (input.extra ?? []).some((e) => e.userId === userId)) throw new ActionError("you can't challenge yourself");
  if (input.opponentId && !state.users.some((u) => u.id === input.opponentId)) throw new ActionError("that person isn't on beef");
  if (input.extra && new Set([input.opponentId, ...input.extra.map((e) => e.userId)]).size !== input.extra.length + 1) throw new ActionError("each friend can only join once");
  // duplicate guard: the same open challenge already exists
  const dupe = state.duels.find((d) => d.createdBy === userId && d.status === "pending"
    && d.participants[0]?.ticker === input.myTicker && d.participants[1]?.ticker === input.opponentTicker
    && (d.participants[1]?.userId || null) === (input.opponentId ?? null) && d.stake === input.stake);
  if (dupe) throw new ActionError("you already sent this exact challenge. it's waiting in your duels.");
  const created = now();
  const duel: Duel = {
    id: newId("d"), createdBy: userId, createdAt: created,
    participants: [
      { userId, ticker: input.myTicker, accepted: true, acceptedAt: created },
      { userId: input.opponentId ?? "", ticker: input.opponentTicker, accepted: false },
      ...(input.extra ?? []).map((e) => ({ userId: e.userId, ticker: e.ticker, accepted: false })),
    ],
    stake: input.stake, visibility: input.visibility, open: input.opponentId === null,
    deadline: input.deadline, deadlineLabel: input.deadlineLabel,
    inviteExpiresAt: new Date(Math.min(Date.now() + 48 * 3600e3, new Date(input.deadline).getTime() - 3600e3)).toISOString(),
    status: "pending", startSnapshots: [], endSnapshots: [], title: input.title?.trim() || undefined,
    communityId: input.communityId, terms: { ...DEFAULT_TERMS },
  };
  if (REMOTE) await syncNow((sb, remote) => remote.createDuel(sb, duel));
  setState((s) => ({ ...s, duels: [duel, ...s.duels] }));
  return duel;
}

function activateIfAllAccepted(d: Duel): Duel {
  if (!d.participants.every((p) => p.accepted && p.userId)) return d;
  const last = d.participants.map((p) => p.acceptedAt).filter((x): x is string => !!x).sort().at(-1) ?? now();
  const lock = nextCloseAfter(new Date(last));
  return { ...d, status: "accepted", lockAt: sessionCloseUtc(lock).toISOString(), participants: d.participants.map((p) => ({ ...p, acceptedAt: last })) };
}

/** current user accepts (or takes the open slot of) a duel */
export async function acceptDuel(id: string, acceptTerms: boolean) {
  const userId = requireUser();
  if (!acceptTerms) throw new ActionError("you need to agree to the terms first");
  const d = state.duels.find((x) => x.id === id);
  if (!d) throw new ActionError("duel not found");
  if (d.status !== "pending") throw new ActionError(`this duel is ${d.status}`);
  if (new Date(d.inviteExpiresAt).getTime() < Date.now()) throw new ActionError("this invitation has expired");
  if (d.stake > practiceBalance(state, userId)) throw new ActionError("not enough practice balance for this stake");
  const slot = d.participants.findIndex((p) => p.userId === userId && !p.accepted);
  const openSlot = d.participants.findIndex((p) => p.userId === "");
  const idx = slot >= 0 ? slot : d.open ? openSlot : -1;
  if (idx < 0) throw new ActionError(d.participants.some((p) => p.userId === userId) ? "you've already accepted" : "this challenge isn't for you");
  if (REMOTE) { await syncNow((sb, remote) => remote.rpc(sb, "accept_duel", id)); await reloadRemote(); return; }
  setState((s) => ({
    ...s,
    duels: s.duels.map((x) => {
      if (x.id !== id) return x;
      const participants = x.participants.map((p, i) => (i === idx ? { ...p, userId, accepted: true, acceptedAt: now() } : p));
      return activateIfAllAccepted({ ...x, participants });
    }),
  }));
}

export async function declineDuel(id: string) {
  const userId = requireUser();
  if (REMOTE) { await syncNow((sb, remote) => remote.rpc(sb, "decline_duel", id)); await reloadRemote(); return; }
  setState((s) => ({
    ...s,
    duels: s.duels.map((x) => (x.id === id && x.status === "pending" && x.participants.some((p) => p.userId === userId && !p.accepted) ? { ...x, status: "declined" } : x)),
  }));
}

export async function cancelDuel(id: string) {
  const userId = requireUser();
  const d = state.duels.find((x) => x.id === id);
  if (!d || d.createdBy !== userId) throw new ActionError("only the creator can cancel");
  if (d.status !== "pending") throw new ActionError("only pending duels can be cancelled. once accepted, terms are locked.");
  if (REMOTE) { await syncNow((sb, remote) => remote.rpc(sb, "cancel_duel", id)); await reloadRemote(); return; }
  setState((s) => ({ ...s, duels: s.duels.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x)) }));
}

/** demo-only: a seeded opponent accepts the invitation */
export function simulateOpponentAccept(id: string) {
  if (REMOTE) throw new ActionError("in live mode your friend has to accept it themselves");
  setState((s) => ({
    ...s,
    duels: s.duels.map((x) => {
      if (x.id !== id || x.status !== "pending") return x;
      const participants = x.participants.map((p) => (p.accepted ? p : { ...p, userId: p.userId || "u_alex", accepted: true, acceptedAt: now() }));
      return activateIfAllAccepted({ ...x, participants });
    }),
    notifications: [
      ...notify({ kind: "duel_accepted", text: "accepted your challenge. prices lock at the next market close.", href: `/duel/${id}`, actorId: s.duels.find((x) => x.id === id)?.participants.find((p) => !p.accepted)?.userId || "u_alex" }),
      ...s.notifications,
    ],
  }));
}

export function expireStaleInvites() {
  if (REMOTE) return; // the database / cron owns duel status
  const t = Date.now();
  if (!state.duels.some((d) => d.status === "pending" && new Date(d.inviteExpiresAt).getTime() < t)) return;
  setState((s) => ({ ...s, duels: s.duels.map((d) => (d.status === "pending" && new Date(d.inviteExpiresAt).getTime() < t ? { ...d, status: "expired" } : d)) }));
}

// ---------- invitation links ----------

/** supabase mode: the duel lives in the database, so the link is just its page.
 *  demo mode: the terms travel in the url fragment so another device can import them. */
export function inviteLink(d: Duel): string {
  return REMOTE ? `/duel/${d.id}` : `/invite#${encodeInvite(d)}`;
}

/** encodes the terms of a pending duel so the link works on another device in demo mode */
export function encodeInvite(d: Duel): string {
  const creator = state.users.find((u) => u.id === d.createdBy);
  const payload = { d, u: creator ? { ...creator, avatar: creator.avatar.startsWith("data:") ? "🙂" : creator.avatar } : null };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function importInvite(code: string): string | null {
  try {
    const json = decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))));
    const { d, u } = JSON.parse(json) as { d: Duel; u: User | null };
    if (!d?.id || !Array.isArray(d.participants) || d.status !== "pending") return d?.id ?? null;
    setState((s) => {
      if (s.duels.some((x) => x.id === d.id)) return s;
      const me = s.session.userId;
      // demo accounts share an id across devices, so a creator that collides with a local
      // user is imported under a distinct id instead of being merged
      const clash = !!u && (u.id === me || s.users.some((x) => x.id === u.id && x.username !== u.username));
      const creatorId = clash ? `${d.createdBy}_${d.id.slice(-4)}` : d.createdBy;
      const users = u && !s.users.some((x) => x.id === creatorId)
        ? [...s.users, { ...u, id: creatorId, username: s.users.some((x) => x.username === u.username) ? `${u.username}.${d.id.slice(-3)}` : u.username }]
        : s.users;
      const participants = d.participants.map((p) => {
        if (p.userId === d.createdBy) return { ...p, userId: creatorId };
        if (p.userId === "") return p; // open slot stays open for whoever accepts
        return p.accepted ? p : { ...p, userId: me ?? "" }; // the invited slot belongs to whoever opens the link
      });
      return { ...s, users, duels: [{ ...d, createdBy: creatorId, participants, open: d.open || !me }, ...s.duels] };
    });
    return d.id;
  } catch {
    return null;
  }
}

// ---------- server-driven transitions ----------

function toSettleable(d: Duel) {
  return {
    id: d.id, status: d.status,
    participants: d.participants.map((p) => ({ userId: p.userId, ticker: p.ticker })),
    acceptedAt: d.participants.map((p) => p.acceptedAt).filter((x): x is string => !!x).sort().at(-1) ?? d.createdAt,
    deadline: d.deadline,
  };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ActionError(json.error ?? `request failed (${res.status})`);
  return json as T;
}

/** asks the server to lock starting prices. simulateAt is honoured only for simulated data. */
export async function requestLock(id: string, simulateAt?: string) {
  const d = state.duels.find((x) => x.id === id);
  if (!d || d.status !== "accepted") return;
  // supabase mode: the server loads the duel from the database by id
  const r = await post<{ ok: boolean; snapshots: PriceSnapshot[]; lockAt: string; issues: string[] }>("/api/duels/lock", REMOTE ? { duelId: id, simulateAt } : { duel: toSettleable(d), simulateAt });
  if (!r.ok) throw new ActionError(r.issues.join("; ") || "prices are not ready to lock yet");
  if (REMOTE) { await reloadRemote(); return; }
  setState((s) => ({
    ...s,
    duels: s.duels.map((x) => (x.id === id && x.status === "accepted" ? { ...x, status: "active", activatedAt: r.lockAt, startSnapshots: r.snapshots } : x)),
    notifications: d.participants.some((p) => p.userId === ME)
      ? [...notify({ kind: "duel_active", text: "your duel is live. starting prices are locked.", href: `/duel/${id}` }), ...s.notifications]
      : s.notifications,
  }));
}

export async function requestSettlement(id: string, simulateAt?: string) {
  const d = state.duels.find((x) => x.id === id);
  if (!d || !["active", "awaiting_verification"].includes(d.status)) return;
  if (d.settlement && d.settlement.status !== "needs_verification") return; // idempotent on the client too
  const r = await post<{ outcome: string; settlement?: Settlement; startSnapshots?: PriceSnapshot[]; endSnapshots?: PriceSnapshot[]; audit?: AuditLog[]; dueAt?: string; reason?: string }>(
    "/api/duels/settle", REMOTE ? { duelId: id, simulateAt } : { duel: toSettleable(d), simulateAt },
  );
  if (r.outcome === "not_due") throw new ActionError("this duel hasn't reached its deadline close yet");
  if (r.outcome === "rejected") throw new ActionError(r.reason ?? "settlement rejected");
  if (REMOTE) { await reloadRemote(); return; }
  const settlement = r.settlement!;
  const status = settlement.status === "needs_verification" ? "awaiting_verification" : "completed";
  const mine = d.participants.some((p) => p.userId === ME);
  setState((s) => ({
    ...s,
    duels: s.duels.map((x) => (x.id !== id ? x : {
      ...x, status, settlement,
      startSnapshots: r.startSnapshots ?? x.startSnapshots,
      endSnapshots: r.endSnapshots ?? x.endSnapshots,
    })),
    audit: { ...s.audit, [id]: r.audit ?? s.audit[id] ?? [] },
    notifications: mine && status === "completed"
      ? [...notify({ kind: "duel_completed", text: settlement.status === "draw" ? "your duel ended in a draw. stakes returned." : settlement.winners.includes(ME) ? "you won your duel! 🏆" : "your duel is settled. see the result.", href: `/duel/${id}` }), ...s.notifications]
      : s.notifications,
  }));
}

/** background housekeeping: lock and settle anything that is due in real time */
export async function tickDuels() {
  expireStaleInvites();
  const t = Date.now();
  for (const d of state.duels) {
    // in supabase mode the server only lets participants trigger lock/settle (cron covers the rest)
    if (REMOTE && !d.participants.some((p) => p.userId === state.session.userId)) continue;
    try {
      if (d.status === "accepted" && d.lockAt && new Date(d.lockAt).getTime() <= t) await requestLock(d.id);
      else if (d.status === "active" && new Date(d.deadline).getTime() <= t) await requestSettlement(d.id);
    } catch {
      /* data not ready yet; retried on the next tick */
    }
  }
}
