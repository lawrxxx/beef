"use client";

// supabase backend for the client store. reads map database rows into the same
// shapes the store uses.
// writes go straight to postgres under row level security; anything cross-user
// (notifications, acceptances, settlement) happens in rpcs, triggers or the server.

import type { SupabaseClient } from "@supabase/supabase-js";
import { nextCloseAfter, sessionCloseUtc } from "@/lib/market/calendar";
import type {
  AuditLog, Comment, Community, DailyBeef, Duel, DuelTerms, Notification, Post, PriceSnapshot, Reaction,
  ReactionKind, Settlement, User,
} from "@/lib/types";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function mapUser(r: any): User {
  return {
    id: r.id, username: r.username, displayName: r.display_name, bio: r.bio ?? "",
    avatar: r.avatar_url || r.avatar_emoji || "🙂", avatarColor: r.avatar_color || "#EEE",
    favoriteStocks: r.favorite_stocks ?? [], joinedAt: r.created_at,
  };
}

function mapDuel(r: any): Duel {
  const parts = [...(r.duel_participants ?? [])].sort((a: any, b: any) =>
    (a.user_id === r.created_by ? -1 : b.user_id === r.created_by ? 1 : 0) || String(a.accepted_at ?? "z").localeCompare(String(b.accepted_at ?? "z")) || a.ticker.localeCompare(b.ticker));
  const order = parts.map((p: any) => p.ticker);
  const snaps = (kind: "start" | "end"): PriceSnapshot[] =>
    (r.duel_price_snapshots ?? []).filter((s: any) => s.kind === kind)
      .sort((a: any, b: any) => order.indexOf(a.ticker) - order.indexOf(b.ticker))
      .map((s: any) => ({
        ticker: s.ticker, kind, price: n(s.price), adjustedPrice: s.adjusted_price == null ? undefined : n(s.adjusted_price),
        session: s.session, timestamp: new Date(s.price_timestamp).toISOString(), source: s.source, simulated: s.simulated,
        priceE18: s.price_e18 != null ? String(s.price_e18) : undefined, adjustedE18: s.adjusted_e18 != null ? String(s.adjusted_e18) : undefined,
        streamId: s.stream_id ?? undefined, observationsTimestamp: s.observations_ts != null ? Number(s.observations_ts) : undefined,
        marketStatus: s.market_status ?? undefined, reportHash: s.report_hash ?? undefined, verification: s.verification ?? undefined,
      }));
  const settlement = one(r.duel_settlements)?.payload as Settlement | undefined;
  const terms: DuelTerms = {
    methodology: r.methodology, provider: r.provider, marketTimezone: "America/New_York",
    priceRule: r.price_rule, settlementRule: r.settlement_rule, calculationVersion: r.calculation_version, funding: "base_sepolia_usdc",
  };
  // accept_duel doesn't compute market closes; derive the lock exactly like the server
  // does (first official close after the last acceptance)
  const lastAccept = parts.map((p: any) => p.accepted_at).filter(Boolean).sort().at(-1);
  const lockAt = r.lock_at
    ? new Date(r.lock_at).toISOString()
    : r.status === "accepted" && lastAccept ? sessionCloseUtc(nextCloseAfter(new Date(lastAccept))).toISOString() : undefined;
  return {
    id: r.id, createdBy: r.created_by, createdAt: r.created_at,
    participants: parts.map((p: any) => ({ userId: p.user_id ?? "", ticker: p.ticker, accepted: p.accepted, acceptedAt: p.accepted_at ?? undefined })),
    stake: n(r.stake), visibility: r.visibility, open: r.is_open,
    deadline: new Date(r.deadline).toISOString(), deadlineLabel: r.deadline_label,
    inviteExpiresAt: new Date(r.invite_expires_at).toISOString(), status: r.status,
    lockAt,
    activatedAt: r.activated_at ? new Date(r.activated_at).toISOString() : undefined,
    startSnapshots: snaps("start"), endSnapshots: snaps("end"),
    settlement: settlement ?? undefined,
    escrowState: r.escrow_state ?? "unfunded", settleTx: r.settle_tx ?? undefined,
    communityId: r.community_id ?? undefined, featured: r.featured, title: r.title ?? undefined, terms,
  };
}

export interface RemoteSnapshot {
  users: User[]; duels: Duel[]; posts: Post[]; comments: Comment[]; reactions: Reaction[];
  follows: { followerId: string; followeeId: string }[]; communities: Community[];
  memberships: { communityId: string; userId: string }[]; notifications: Notification[];
  daily: DailyBeef[]; audit: Record<string, AuditLog[]>;
  me: { id: string; email?: string; hasProfile: boolean; onboarded: boolean; adult: boolean } | null;
}

async function must<T>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

/** loads everything the app shows. the latest few hundred rows. */
export async function loadSnapshot(sb: SupabaseClient): Promise<RemoteSnapshot> {
  const { data: auth } = await sb.auth.getSession();
  const uid = auth.session?.user.id ?? null;

  const [profiles, duels, posts, pc, dc, pr, dr, follows, comms, members, notes, daily, picks, audit] = await Promise.all([
    must<any[]>(sb.from("profiles").select("*").limit(1000)),
    must<any[]>(sb.from("duels").select("*, duel_participants(*), duel_price_snapshots(*), duel_settlements(payload)").order("created_at", { ascending: false }).limit(400)),
    must<any[]>(sb.from("posts").select("*, predictions(pick, versus, horizon)").order("created_at", { ascending: false }).limit(300)),
    must<any[]>(sb.from("post_comments").select("*").order("created_at", { ascending: false }).limit(1000)),
    must<any[]>(sb.from("duel_comments").select("*").order("created_at", { ascending: false }).limit(1000)),
    must<any[]>(sb.from("post_reactions").select("*").limit(5000)),
    must<any[]>(sb.from("duel_reactions").select("*").limit(5000)),
    must<any[]>(sb.from("follows").select("*").limit(10000)),
    must<any[]>(sb.from("communities").select("*")),
    must<any[]>(sb.from("community_members").select("*").limit(10000)),
    uid ? must<any[]>(sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100)) : Promise.resolve([]),
    must<any[]>(sb.from("daily_beefs").select("*").order("session", { ascending: false }).limit(10)),
    must<any[]>(sb.from("daily_picks").select("*").order("session", { ascending: false }).limit(5000)),
    must<any[]>(sb.from("settlement_audit_logs").select("*").order("at").limit(2000)),
  ]);

  const meRow = uid ? profiles.find((p) => p.id === uid) : null;
  const auditBy: Record<string, AuditLog[]> = {};
  for (const a of audit) (auditBy[a.duel_id] ??= []).push({ id: String(a.id), duelId: a.duel_id, at: a.at, action: a.action, detail: a.detail });

  return {
    users: profiles.map(mapUser),
    duels: duels.map(mapDuel),
    posts: posts.map((p) => {
      const pred = one(p.predictions);
      return {
        id: p.id, authorId: p.author_id, createdAt: p.created_at, kind: p.kind, body: p.body,
        prediction: pred ? { pick: pred.pick, versus: pred.versus, horizon: pred.horizon } : undefined,
        duelId: p.duel_id ?? undefined, communityId: p.community_id ?? undefined, tickers: p.tickers ?? [],
      };
    }),
    comments: [
      ...pc.map((c) => ({ id: c.id, targetType: "post" as const, targetId: c.post_id, authorId: c.author_id, body: c.body, createdAt: c.created_at })),
      ...dc.map((c) => ({ id: c.id, targetType: "duel" as const, targetId: c.duel_id, authorId: c.author_id, body: c.body, createdAt: c.created_at })),
    ],
    reactions: [
      ...pr.map((r) => ({ targetType: "post" as const, targetId: r.post_id, userId: r.user_id, kind: r.kind as ReactionKind })),
      ...dr.map((r) => ({ targetType: "duel" as const, targetId: r.duel_id, userId: r.user_id, kind: r.kind as ReactionKind })),
    ],
    follows: follows.map((f) => ({ followerId: f.follower_id, followeeId: f.followee_id })),
    communities: comms.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, emoji: c.emoji, tickers: c.tickers ?? [], createdBy: c.created_by, createdAt: c.created_at })),
    memberships: members.map((m) => ({ communityId: m.community_id, userId: m.user_id })),
    notifications: notes.map((x) => ({ id: x.id, userId: x.user_id, kind: x.kind, actorId: x.actor_id ?? undefined, text: x.text, href: x.href, createdAt: x.created_at, read: x.read })),
    daily: daily.map((d) => ({
      id: d.session, session: d.session, a: d.ticker_a, b: d.ticker_b,
      picks: Object.fromEntries(picks.filter((p) => p.session === d.session).map((p) => [p.user_id, p.ticker])),
    })),
    audit: auditBy,
    me: uid ? { id: uid, email: auth.session?.user.email ?? undefined, hasProfile: !!meRow, onboarded: !!meRow?.onboarded, adult: !!meRow?.is_adult } : null,
  };
}

const TABLES = ["posts", "post_comments", "post_reactions", "duel_comments", "duel_reactions", "duels", "duel_participants", "follows", "notifications", "community_members", "daily_picks"];

/** any change in a shared table triggers a (debounced) reload */
export function subscribe(sb: SupabaseClient, onChange: () => void) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const fire = () => { if (t) clearTimeout(t); t = setTimeout(onChange, 600); };
  const ch = sb.channel("beef-live");
  for (const table of TABLES) ch.on("postgres_changes", { event: "*", schema: "public", table }, fire);
  ch.subscribe();
  return () => { sb.removeChannel(ch); };
}

// ---------- writes ----------

async function ok(p: PromiseLike<{ error: any }>) {
  const { error } = await p;
  if (error) throw new Error(error.message.toLowerCase());
}

export const remote = {
  createPost: (sb: SupabaseClient, p: Post) =>
    ok(sb.from("posts").insert({ id: p.id, author_id: p.authorId, kind: p.kind, body: p.body, duel_id: p.duelId ?? null, community_id: p.communityId ?? null, tickers: p.tickers }))
      .then(() => p.prediction ? ok(sb.from("predictions").insert({ post_id: p.id, user_id: p.authorId, pick: p.prediction.pick, versus: p.prediction.versus, horizon: p.prediction.horizon })) : undefined),

  setReaction: (sb: SupabaseClient, targetType: "post" | "duel", targetId: string, userId: string, kind: ReactionKind | null) => {
    const table = targetType === "post" ? "post_reactions" : "duel_reactions";
    const key = targetType === "post" ? "post_id" : "duel_id";
    return kind
      ? ok(sb.from(table).upsert({ [key]: targetId, user_id: userId, kind }, { onConflict: `${key},user_id` }))
      : ok(sb.from(table).delete().eq(key, targetId).eq("user_id", userId));
  },

  addComment: (sb: SupabaseClient, c: Comment) =>
    c.targetType === "post"
      ? ok(sb.from("post_comments").insert({ id: c.id, post_id: c.targetId, author_id: c.authorId, body: c.body }))
      : ok(sb.from("duel_comments").insert({ id: c.id, duel_id: c.targetId, author_id: c.authorId, body: c.body })),

  deleteComment: async (sb: SupabaseClient, id: string) => {
    await ok(sb.from("post_comments").delete().eq("id", id));
    await ok(sb.from("duel_comments").delete().eq("id", id));
  },

  follow: (sb: SupabaseClient, followerId: string, followeeId: string, on: boolean) =>
    on ? ok(sb.from("follows").insert({ follower_id: followerId, followee_id: followeeId }))
      : ok(sb.from("follows").delete().eq("follower_id", followerId).eq("followee_id", followeeId)),

  membership: (sb: SupabaseClient, communityId: string, userId: string, on: boolean) =>
    on ? ok(sb.from("community_members").insert({ community_id: communityId, user_id: userId }))
      : ok(sb.from("community_members").delete().eq("community_id", communityId).eq("user_id", userId)),

  createCommunity: async (sb: SupabaseClient, c: Community) => {
    await ok(sb.from("communities").insert({ id: c.id, slug: c.slug, name: c.name, description: c.description, emoji: c.emoji, tickers: c.tickers, created_by: c.createdBy }));
    await ok(sb.from("community_members").insert({ community_id: c.id, user_id: c.createdBy }));
  },

  markRead: (sb: SupabaseClient, ids: string[] | "all", userId: string) =>
    ids === "all"
      ? ok(sb.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false))
      : ok(sb.from("notifications").update({ read: true }).in("id", ids)),

  ensureDaily: (sb: SupabaseClient, d: DailyBeef) =>
    ok(sb.from("daily_beefs").upsert({ session: d.session, ticker_a: d.a, ticker_b: d.b }, { onConflict: "session", ignoreDuplicates: true })),

  pickDaily: (sb: SupabaseClient, session: string, userId: string, ticker: string) =>
    ok(sb.from("daily_picks").insert({ session, user_id: userId, ticker })),

  updateProfile: (sb: SupabaseClient, userId: string, patch: Partial<User> & { onboarded?: boolean; isAdult?: boolean; country?: string }) => {
    const row: Record<string, unknown> = {};
    if (patch.username !== undefined) row.username = patch.username;
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.avatarColor !== undefined) row.avatar_color = patch.avatarColor;
    if (patch.favoriteStocks !== undefined) row.favorite_stocks = patch.favoriteStocks;
    if (patch.avatar !== undefined) {
      const isUrl = /^(https?:|data:)/.test(patch.avatar);
      row.avatar_url = isUrl ? patch.avatar : null;
      if (!isUrl) row.avatar_emoji = patch.avatar;
    }
    if (patch.onboarded !== undefined) row.onboarded = patch.onboarded;
    if (patch.isAdult !== undefined) row.is_adult = patch.isAdult;
    if (patch.country !== undefined) row.country = patch.country;
    return ok(sb.from("profiles").update(row).eq("id", userId));
  },

  createDuel: async (sb: SupabaseClient, d: Duel) => {
    await ok(sb.from("duels").insert({
      id: d.id, created_by: d.createdBy, title: d.title ?? null, stake: d.stake, visibility: d.visibility, is_open: d.open,
      deadline: d.deadline, deadline_label: d.deadlineLabel, invite_expires_at: d.inviteExpiresAt, community_id: d.communityId ?? null,
      methodology: d.terms.methodology, provider: d.terms.provider, price_rule: d.terms.priceRule, settlement_rule: d.terms.settlementRule,
      calculation_version: d.terms.calculationVersion, created_at: d.createdAt,
    }));
    // creator first (accepted), then the invited slots (which fire invite notifications)
    const [creator, ...rest] = d.participants;
    await ok(sb.from("duel_participants").insert({ duel_id: d.id, user_id: creator.userId, ticker: creator.ticker, accepted: true, accepted_at: creator.acceptedAt }));
    await ok(sb.from("duel_participants").insert(rest.map((p) => ({ duel_id: d.id, user_id: p.userId || null, ticker: p.ticker, accepted: false }))));
  },

  rpc: (sb: SupabaseClient, fn: "decline_duel" | "cancel_duel", duelId: string) => ok(sb.rpc(fn, { p_duel: duelId })),

  usernameAvailable: async (sb: SupabaseClient, username: string): Promise<boolean> => {
    const { data, error } = await sb.rpc("username_available", { p_username: username });
    if (error) throw new Error(error.message.toLowerCase());
    return data === true;
  },

  createProfile: (sb: SupabaseClient, p: { id: string; username: string; displayName: string; bio: string; avatar: string; avatarColor: string; referredBy: string | null }) => {
    const isUrl = /^(https?:|data:)/.test(p.avatar);
    return ok(sb.from("profiles").insert({
      id: p.id, username: p.username, display_name: p.displayName, bio: p.bio,
      avatar_url: isUrl ? p.avatar : null, avatar_emoji: isUrl ? null : p.avatar, avatar_color: p.avatarColor,
      referred_by: p.referredBy,
    })).catch((e: Error) => { throw new Error(/duplicate|unique/.test(e.message) ? "that username is taken" : e.message); });
  },
};
