// core domain types shared by client, server and settlement engine.

export type Ticker = string;

export interface StockAsset {
  ticker: Ticker;
  name: string;
  sector: string;
}

export type { LiveQuote as Quote } from "@/lib/chainlink/prices";

export type DuelStatus =
  | "pending"
  | "accepted"
  | "active"
  | "awaiting_verification"
  | "completed"
  | "cancelled"
  | "declined"
  | "expired";

export type DuelVisibility = "public" | "friends" | "private";

export interface DuelParticipant {
  userId: string;
  ticker: Ticker;
  accepted: boolean;
  acceptedAt?: string;
}

export interface PriceSnapshot {
  ticker: Ticker;
  kind: "start" | "end";
  /** display value; priceE18 is the exact chainlink mid (18 decimals) */
  price: number;
  priceE18?: string;
  /** split-adjusted price used in the calculation, when different */
  adjustedPrice?: number;
  adjustedE18?: string;
  session: string;
  timestamp: string;
  source: string;
  simulated: boolean;
  /** chainlink evidence */
  streamId?: string;
  observationsTimestamp?: number;
  marketStatus?: number;
  reportHash?: string;
  verification?: { status: string; method: string; verifier: string; configDigest: string | null; checkedAt: string };
}

export interface SettlementEntry {
  userId: string;
  ticker: Ticker;
  startPrice: number;
  endPrice: number;
  returnPct: number;
  rank: number;
  /** exact values: 18-decimal prices, return as percent × 1e6 */
  startE18?: string;
  endE18?: string;
  returnE6?: string;
}

/** what a settlement is based on: one chainlink report per stock per end of the window */
export interface SettlementEvidence {
  ticker: Ticker;
  kind: "start" | "end";
  streamId: string;
  observationsTimestamp: number;
  marketStatus: number;
  midE18: string;
  reportHash: string;
  verification: string;
}

export interface Settlement {
  duelId: string;
  status: "settled" | "draw" | "needs_verification";
  /** user ids of winners. empty for draw / needs_verification */
  winners: string[];
  winningTicker?: Ticker;
  /** percentage points between first and second */
  marginPct: number;
  /** exact margin in 0.0001 percentage points */
  marginE4?: string;
  entries: SettlementEntry[];
  explanation: string;
  calculationVersion: string;
  methodology: string;
  source: string;
  simulated: boolean;
  startSession: string;
  endSession: string;
  settledAt: string;
  issues: string[];
  /** the comparison window: both stocks use exactly these two timestamps (unix seconds) */
  window?: { startSession: string; endSession: string; startTimestamp: number; endTimestamp: number };
  evidence?: SettlementEvidence[];
}

export interface AuditLog {
  id: string;
  duelId: string;
  at: string;
  action: string;
  detail: string;
}

export interface Duel {
  id: string;
  createdBy: string;
  createdAt: string;
  participants: DuelParticipant[];
  /** stake per participant in usd */
  stake: number;
  visibility: DuelVisibility;
  /** open challenge anyone can accept (opponent slot userId === "") */
  open: boolean;
  /** iso utc. the official close used for settlement */
  deadline: string;
  deadlineLabel: string;
  /** invitation expiry, iso utc */
  inviteExpiresAt: string;
  status: DuelStatus;
  /** iso utc of the close that locked starting prices */
  lockAt?: string;
  activatedAt?: string;
  startSnapshots: PriceSnapshot[];
  endSnapshots: PriceSnapshot[];
  settlement?: Settlement;
  /** base sepolia transaction that paid out (settle) or refunded the escrow */
  settleTx?: string;
  /** escrow state recorded from verified onchain events */
  escrowState?: "unfunded" | "funded" | "active" | "settled" | "refunded";
  communityId?: string;
  featured?: boolean;
  title?: string;
  // fixed terms recorded at creation
  terms: DuelTerms;
}

export interface DuelTerms {
  methodology: string;
  provider: string;
  marketTimezone: "America/New_York";
  priceRule: string;
  settlementRule: string;
  calculationVersion: string;
  /** stakes are test usdc on base sepolia, held by the beef escrow contract */
  funding: "base_sepolia_usdc";
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string; // emoji or url
  avatarColor: string;
  favoriteStocks: Ticker[];
  joinedAt: string;
  verified?: boolean;
}

export type PostKind = "opinion" | "duel" | "result" | "text";

export interface Post {
  id: string;
  authorId: string;
  createdAt: string;
  kind: PostKind;
  body: string;
  /** opinion posts: bullish pick vs comparison */
  prediction?: { pick: Ticker; versus: Ticker; horizon: string };
  duelId?: string;
  communityId?: string;
  tickers: Ticker[];
}

export interface Comment {
  id: string;
  targetType: "post" | "duel";
  targetId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type ReactionKind = "fire" | "bull" | "bear" | "laugh" | "clap";

export interface Reaction {
  targetType: "post" | "duel";
  targetId: string;
  userId: string;
  kind: ReactionKind;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  tickers: Ticker[];
  createdBy: string;
  createdAt: string;
}

export type NotificationKind =
  | "duel_invite"
  | "duel_accepted"
  | "duel_declined"
  | "duel_completed"
  | "duel_active"
  | "comment"
  | "reaction"
  | "follow"
  | "rivalry"
  | "community"
  | "achievement";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  actorId?: string;
  text: string;
  href: string;
  createdAt: string;
  read: boolean;
}

export interface DailyBeef {
  id: string; // session date
  session: string;
  a: Ticker;
  b: Ticker;
  /** userId -> pick */
  picks: Record<string, Ticker>;
}
