// core domain types shared by client, server and settlement engine.

export type Ticker = string;

export interface StockAsset {
  ticker: Ticker;
  name: string;
  sector: string;
  /** anchor price used by the deterministic mock provider */
  basePrice: number;
  /** daily volatility used by the mock provider */
  vol: number;
  /** drift per session used by the mock provider */
  drift: number;
  /** whether a tokenized version is configured on base (informational only) */
  tokenized?: boolean;
}

export interface Quote {
  ticker: Ticker;
  price: number;
  /** change vs previous official close, percent */
  changePct: number;
  previousClose: number;
  /** iso utc timestamp of the price */
  asOf: string;
  source: string;
  simulated: boolean;
  marketOpen: boolean;
}

export interface ClosePrice {
  ticker: Ticker;
  /** session date in market timezone, yyyy-mm-dd */
  session: string;
  close: number;
  /** iso utc timestamp of the official close */
  timestamp: string;
  source: string;
  simulated: boolean;
  /** when set, data is unusable for settlement */
  status: "ok" | "missing" | "halted" | "invalid";
}

export interface CorporateAction {
  ticker: Ticker;
  type: "split";
  /** effective session date (first session trading at the new basis) */
  session: string;
  /** e.g. 4 for a 4-for-1 split */
  ratio: number;
}

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
  price: number;
  /** split-adjusted price used in the calculation, when different */
  adjustedPrice?: number;
  session: string;
  timestamp: string;
  source: string;
  simulated: boolean;
}

export interface SettlementEntry {
  userId: string;
  ticker: Ticker;
  startPrice: number;
  endPrice: number;
  returnPct: number;
  rank: number;
}

export interface Settlement {
  duelId: string;
  status: "settled" | "draw" | "needs_verification";
  /** user ids of winners. empty for draw / needs_verification */
  winners: string[];
  winningTicker?: Ticker;
  /** percentage points between first and second */
  marginPct: number;
  entries: SettlementEntry[];
  explanation: string;
  calculationVersion: string;
  methodology: "percent_return_official_close";
  source: string;
  simulated: boolean;
  startSession: string;
  endSession: string;
  settledAt: string;
  issues: string[];
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
  communityId?: string;
  featured?: boolean;
  title?: string;
  // fixed terms recorded at creation
  terms: DuelTerms;
}

export interface DuelTerms {
  methodology: "percent_return_official_close";
  provider: string;
  marketTimezone: "America/New_York";
  priceRule: string;
  settlementRule: string;
  calculationVersion: string;
  simulatedFunds: boolean;
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

export interface SimTransaction {
  id: string;
  userId: string;
  kind: "stake_lock" | "payout" | "refund" | "faucet";
  amount: number;
  duelId?: string;
  createdAt: string;
  /** simulated until a real chain integration is enabled */
  state: "simulated" | "pending" | "confirmed";
  txHash?: string; // only for real confirmed chain transactions
}
