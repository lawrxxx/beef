import type {
  Comment, Community, DailyBeef, Duel, DuelStatus, DuelTerms, Notification, Post, PriceSnapshot,
  Reaction, ReactionKind, SimTransaction, User,
} from "@/lib/types";
import { mockCloseSync } from "@/lib/market/mock";
import { MOCK_CORPORATE_ACTIONS } from "@/lib/market/assets";
import {
  nextCloseAfter, resolveEndSession, sessionCloseUtc, prevTradingDay, nextTradingDay, lastCloseAtOrBefore,
} from "@/lib/market/calendar";
import { buildSettlement, compareReturns, CALCULATION_VERSION } from "@/lib/settlement/engine";

// demo dataset. every price comes from the deterministic simulated provider and
// every result is computed by the same settlement engine the server uses.
//
// the live part of the demo (active duels, invites, recent history, posts) is anchored
// to the current time, so the demo looks the same whenever it is opened. the three
// reference duels (both rise / both fall / identical) and the halted-data duel keep
// fixed dates because they rely on scripted simulated prices.

export const ME = "u_me";

const FIXED_REFERENCE_NOW = Date.parse("2026-11-25T17:00:00.000Z");
/** "now" for the seed, rounded to 10 minutes so server and client agree */
export const SEED_NOW = new Date(Math.floor(Math.max(Date.now(), FIXED_REFERENCE_NOW) / 600_000) * 600_000).toISOString();
const NOW = new Date(SEED_NOW);

export const DEFAULT_TERMS: DuelTerms = {
  methodology: "percent_return_official_close",
  provider: "mock",
  marketTimezone: "America/New_York",
  priceRule: "starting prices lock at the first official close after both sides accept. ending prices are the official close of the deadline session.",
  settlementRule: "higher percentage return wins. identical returns (to 0.0001 points) are a draw. weekend or holiday deadlines use the last close at or before the deadline; if that is not after the lock, the next trading session.",
  calculationVersion: CALCULATION_VERSION,
  simulatedFunds: true,
};

const u = (
  id: string, username: string, displayName: string, avatar: string, avatarColor: string, bio: string,
  favoriteStocks: string[], verified = false,
): User => ({ id, username, displayName, avatar, avatarColor, bio, favoriteStocks, verified, joinedAt: "2026-06-01T12:00:00Z" });

export const seedUsers: User[] = [
  { id: ME, username: "demo", displayName: "demo trader", avatar: "🧑‍🍳", avatarColor: "#FDE7D9", bio: "exploring beef in demo mode.", favoriteStocks: ["NVDA", "TSLA"], joinedAt: "2026-11-01T12:00:00Z" },
  u("u_alex", "alexrivers", "alex rivers", "🦈", "#DCEBFF", "semis maxi. if it has a gpu i'm long.", ["NVDA", "AMD", "PLTR"], true),
  u("u_maya", "mayabuys", "maya", "🌸", "#FBE3EE", "apple since the ipod. quality > hype.", ["AAPL", "COST", "MSFT"]),
  u("u_jordan", "jordanj", "jordan j", "🏀", "#FFF1CC", "fantasy football brain applied to stocks.", ["MSFT", "TSLA", "AMZN"]),
  u("u_sam", "samtrades", "sam", "🎧", "#E3F6EA", "short attention span, long conviction.", ["COIN", "TSLA"]),
  u("u_priya", "priyacharts", "priya", "📐", "#EAE6FF", "charts tell stories. i read them.", ["AMZN", "GOOGL", "MSFT"], true),
  u("u_leo", "leolongterm", "leo", "🐢", "#E6F2EF", "buy, hold, touch grass.", ["GOOGL", "KO", "JPM"]),
  u("u_nia", "niaonfire", "nia", "🔥", "#FFE2DC", "meta bull. reels are the new tv.", ["META", "NFLX"]),
  u("u_kai", "kaiyolo", "kai", "🚀", "#E2F0FF", "here for the vibes and the volatility.", ["GME", "PLTR", "TSLA"]),
  u("u_zoe", "zoe.memes", "zoe", "🐸", "#E9F7DF", "amc apologist. diamond hands, paper wallet.", ["AMC", "GME"]),
  u("u_omar", "omarvalue", "omar", "📚", "#F3EBDD", "value investor. reading 10-ks for fun.", ["JPM", "KO", "COST"]),
  u("u_ellie", "elliedca", "ellie", "🌙", "#ECE8F7", "dollar cost averaging my way to peace.", ["MSFT", "AAPL", "AMZN"]),
  u("u_ravi", "ravisemis", "ravi", "🔬", "#E1F3F8", "fab tours > vacations. tsm and avgo.", ["TSM", "AVGO", "NVDA"], true),
];

// ---------- session helpers (relative to now) ----------

const LAST = lastCloseAtOrBefore(NOW);
/** k trading sessions before the most recent close (back(0) = most recent close) */
function back(k: number) { let s = LAST; for (let i = 0; i < k; i++) s = prevTradingDay(s); return s; }
/** k trading sessions after the most recent close */
function fwd(k: number) { let s = LAST; for (let i = 0; i < k; i++) s = nextTradingDay(s); return s; }
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600e3).toISOString();

// ---------- duels ----------

const accAt = (session: string) => new Date(sessionCloseUtc(session).getTime() - 5 * 3600e3).toISOString(); // during the session

function snap(ticker: string, session: string, kind: "start" | "end"): PriceSnapshot | null {
  const c = mockCloseSync(ticker, session);
  if (c == null) return null;
  return { ticker, kind, price: c, session, timestamp: sessionCloseUtc(session).toISOString(), source: "mock", simulated: true };
}

/** same split rule as the settlement service: start price on the ending share basis */
function splitFactor(ticker: string, from: string, to: string) {
  return MOCK_CORPORATE_ACTIONS.filter((c) => c.ticker === ticker && c.session > from && c.session <= to).reduce((f, c) => f * c.ratio, 1);
}

interface DuelSpec {
  id: string;
  by: string;
  sides: [string, string][]; // [userId, ticker]
  stake: number;
  acceptedSession?: string;
  acceptedAt?: string;
  endSession: string;
  status: DuelStatus;
  label: string;
  title?: string;
  communityId?: string;
  open?: boolean;
  featured?: boolean;
  createdAt?: string;
}

function makeDuel(s: DuelSpec): Duel {
  const accepted = s.acceptedAt ?? (s.acceptedSession ? accAt(s.acceptedSession) : undefined);
  const deadline = sessionCloseUtc(s.endSession).toISOString();
  const createdAt = s.createdAt ?? (accepted ? new Date(new Date(accepted).getTime() - 20 * 3600e3).toISOString() : hoursAgo(3));
  const d: Duel = {
    id: s.id, createdBy: s.by, createdAt,
    participants: s.sides.map(([userId, ticker]) => ({
      userId, ticker,
      accepted: ["accepted", "active", "completed", "awaiting_verification"].includes(s.status) || userId === s.by,
      acceptedAt: accepted ?? (userId === s.by ? createdAt : undefined),
    })),
    stake: s.stake, visibility: "public", open: !!s.open,
    deadline, deadlineLabel: s.label,
    inviteExpiresAt: new Date(new Date(createdAt).getTime() + 48 * 3600e3).toISOString(),
    status: s.status, startSnapshots: [], endSnapshots: [],
    communityId: s.communityId, featured: s.featured, title: s.title,
    terms: DEFAULT_TERMS,
  };
  if (!accepted) return d;

  const lock = nextCloseAfter(new Date(accepted));
  d.lockAt = sessionCloseUtc(lock).toISOString();
  if (new Date(d.lockAt) <= NOW) {
    d.activatedAt = d.lockAt;
    d.startSnapshots = s.sides.map(([, t]) => snap(t, lock, "start")!).filter(Boolean);
    if (d.status === "accepted") d.status = "active";
  }
  if (s.status === "completed" || s.status === "awaiting_verification") {
    const end = resolveEndSession(new Date(deadline), lock);
    const ends = s.sides.map(([, t]) => snap(t, end, "end"));
    if (ends.some((e) => !e)) {
      d.status = "awaiting_verification";
      const missing = s.sides.filter((_, i) => !ends[i]).map(([, t]) => t);
      d.settlement = {
        duelId: d.id, status: "needs_verification", winners: [], marginPct: 0, entries: [],
        explanation: "settlement is paused because reliable price data is not available yet. no winner has been declared.",
        calculationVersion: CALCULATION_VERSION, methodology: "percent_return_official_close",
        source: "mock", simulated: true, startSession: lock, endSession: end, settledAt: deadline,
        issues: missing.map((t) => `${t}: trading halted on ${end}`),
      };
      return d;
    }
    d.endSnapshots = ends as PriceSnapshot[];
    d.startSnapshots = d.startSnapshots.map((sn) => {
      const f = splitFactor(sn.ticker, lock, end);
      return f === 1 ? sn : { ...sn, adjustedPrice: Math.round((sn.price / f) * 1e6) / 1e6 };
    });
    const result = compareReturns(s.sides.map(([userId, ticker], i) => ({
      userId, ticker, startPrice: d.startSnapshots[i].adjustedPrice ?? d.startSnapshots[i].price, endPrice: d.endSnapshots[i].price,
    })));
    const settledAt = new Date(new Date(deadline).getTime() + 15 * 60e3).toISOString();
    d.settlement = buildSettlement(d.id, result, { source: "mock", simulated: true, startSession: lock, endSession: end, settledAt });
  }
  return d;
}

// deterministic history so leaderboards, records and rivalries come from real duels
function history(): Duel[] {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const players = ["u_alex", "u_maya", "u_jordan", "u_sam", "u_priya", "u_leo", "u_nia", "u_kai", "u_zoe", "u_omar", "u_ellie", "u_ravi"];
  const tickers = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "AMD", "AVGO", "TSM", "NFLX", "PLTR", "COIN", "GME", "JPM", "KO", "COST", "DIS"];
  const out: Duel[] = [];
  for (let i = 0; i < 44; i++) {
    const endIdx = 1 + Math.floor(Math.pow(rnd(), 1.5) * 55);
    const len = [3, 4, 5, 5, 5, 10][Math.floor(rnd() * 6)];
    const a = players[Math.floor(rnd() * players.length)];
    let b = players[Math.floor(rnd() * players.length)];
    if (b === a) b = players[(players.indexOf(a) + 1) % players.length];
    const pa = i % 11 === 3 ? ME : a; // the demo account has some history too
    const ta = tickers[Math.floor(rnd() * tickers.length)];
    let tb = tickers[Math.floor(rnd() * tickers.length)];
    if (tb === ta) tb = tickers[(tickers.indexOf(ta) + 3) % tickers.length];
    out.push(makeDuel({
      id: `h_${i}`, by: pa, sides: [[pa, ta], [b, tb]], stake: [5, 5, 10, 10, 20][Math.floor(rnd() * 5)],
      acceptedSession: back(endIdx + len), endSession: back(endIdx), status: "completed",
      label: len >= 10 ? "2 weeks" : len === 5 ? "1 week" : `${len} sessions`,
    }));
  }
  return out;
}

export const seedDuels: Duel[] = [
  // the three reference outcomes (scripted simulated prices, fixed dates)
  makeDuel({ id: "d_rise", by: "u_alex", sides: [["u_alex", "NVDA"], ["u_maya", "AAPL"]], stake: 10, acceptedSession: "2026-10-30", endSession: "2026-11-06", status: "completed", label: "1 week", title: "the classic: chips vs phones" }),
  makeDuel({ id: "d_fall", by: "u_sam", sides: [["u_sam", "TSLA"], ["u_nia", "META"]], stake: 15, acceptedSession: "2026-11-09", endSession: "2026-11-13", status: "completed", label: "until friday" }),
  makeDuel({ id: "d_draw", by: "u_priya", sides: [["u_priya", "MSFT"], ["u_leo", "GOOGL"]], stake: 10, acceptedSession: "2026-11-02", endSession: "2026-11-06", status: "completed", label: "until friday", title: "cloud wars" }),
  // paused: simulated trading halt (fixed date)
  makeDuel({ id: "d_halt", by: "u_kai", sides: [["u_kai", "SMCI"], ["u_ravi", "AMD"]], stake: 10, acceptedSession: "2026-11-16", endSession: "2026-11-20", status: "completed", label: "until friday" }),
  // recent results
  makeDuel({ id: "d_c4", by: "u_maya", sides: [["u_maya", "AMD"], ["u_alex", "NVDA"]], stake: 10, acceptedSession: back(13), endSession: back(8), status: "completed", label: "1 week", title: "rematch" }),
  makeDuel({ id: "d_c5", by: "u_alex", sides: [["u_alex", "NVDA"], [ME, "TSLA"]], stake: 5, acceptedSession: back(10), endSession: back(5), status: "completed", label: "1 week" }),
  makeDuel({ id: "d_c6", by: ME, sides: [[ME, "META"], ["u_maya", "AAPL"]], stake: 10, acceptedSession: back(7), endSession: back(2), status: "completed", label: "1 week" }),
  makeDuel({ id: "d_c7", by: "u_omar", sides: [["u_omar", "KO"], ["u_kai", "GME"]], stake: 5, acceptedSession: back(9), endSession: back(4), status: "completed", label: "1 week", title: "boring vs chaos" }),
  makeDuel({ id: "d_group", by: "u_ravi", sides: [["u_ravi", "TSM"], ["u_alex", "NVDA"], ["u_maya", "AMD"], ["u_ellie", "AVGO"]], stake: 5, acceptedSession: back(16), endSession: back(3), status: "completed", label: "3 weeks", title: "semis showdown", communityId: "c_semis" }),
  // live
  makeDuel({ id: "d_live1", by: ME, sides: [[ME, "NVDA"], ["u_jordan", "MSFT"]], stake: 10, acceptedSession: back(3), endSession: fwd(2), status: "active", label: "1 week" }),
  makeDuel({ id: "d_live2", by: "u_alex", sides: [["u_alex", "PLTR"], ["u_sam", "COIN"]], stake: 20, acceptedSession: back(4), endSession: fwd(6), status: "active", label: "2 weeks" }),
  makeDuel({ id: "d_live3", by: "u_maya", sides: [["u_maya", "COST"], ["u_priya", "AMZN"]], stake: 10, acceptedSession: back(6), endSession: fwd(15), status: "active", label: "1 month", title: "shopping spree" }),
  makeDuel({ id: "d_live4", by: "u_nia", sides: [["u_nia", "META"], ["u_leo", "GOOGL"]], stake: 10, acceptedSession: back(1), endSession: fwd(4), status: "active", label: "1 week", communityId: "c_tech", featured: true, title: "ads ads ads" }),
  // everyone accepted, waiting for the next close to lock prices
  makeDuel({ id: "d_acc", by: "u_kai", sides: [["u_kai", "GME"], ["u_zoe", "AMC"]], stake: 5, acceptedAt: hoursAgo(1), endSession: fwd(6), status: "accepted", label: "1 week", communityId: "c_meme", title: "meme civil war" }),
  // invitations
  makeDuel({ id: "d_inv", by: "u_jordan", sides: [["u_jordan", "TSLA"], [ME, "AAPL"]], stake: 10, endSession: fwd(5), status: "pending", label: "1 week", createdAt: hoursAgo(2.8) }),
  makeDuel({ id: "d_inv2", by: "u_kai", sides: [["u_kai", "GME"], [ME, "MSFT"]], stake: 5, endSession: fwd(4), status: "pending", label: "1 week", title: "chaos vs calm", createdAt: hoursAgo(6) }),
  makeDuel({ id: "d_open", by: "u_ellie", sides: [["u_ellie", "AMZN"], ["", "GOOGL"]], stake: 5, endSession: fwd(5), status: "pending", label: "1 week", open: true, title: "open challenge: who takes googl?", createdAt: hoursAgo(4) }),
  // closed out
  makeDuel({ id: "d_cancel", by: "u_sam", sides: [["u_sam", "COIN"], ["u_omar", "JPM"]], stake: 10, endSession: back(5), status: "cancelled", label: "1 week", createdAt: hoursAgo(24 * 12) }),
  makeDuel({ id: "d_expired", by: "u_zoe", sides: [["u_zoe", "AMC"], ["u_ellie", "MSFT"]], stake: 5, endSession: back(6), status: "expired", label: "1 week", createdAt: hoursAgo(24 * 14) }),
  ...history(),
];

// ---------- communities ----------

export const seedCommunities: Community[] = [
  { id: "c_tech", slug: "tech-stocks", name: "tech stocks", emoji: "💻", description: "big tech, earnings calls and the occasional antitrust drama.", tickers: ["AAPL", "MSFT", "GOOGL", "META", "AMZN"], createdBy: "u_priya", createdAt: "2026-07-01T00:00:00Z" },
  { id: "c_ai", slug: "ai-stocks", name: "ai stocks", emoji: "🤖", description: "who actually makes money from ai? we argue about it daily.", tickers: ["NVDA", "MSFT", "PLTR", "GOOGL"], createdBy: "u_alex", createdAt: "2026-07-02T00:00:00Z" },
  { id: "c_semis", slug: "semiconductors", name: "semiconductors", emoji: "🔬", description: "fabs, chips and supply chains.", tickers: ["NVDA", "AMD", "TSM", "AVGO", "SMCI"], createdBy: "u_ravi", createdAt: "2026-07-03T00:00:00Z" },
  { id: "c_long", slug: "long-term", name: "long-term investors", emoji: "🐢", description: "slow money. compounding. no day trading talk.", tickers: ["KO", "JPM", "COST", "MSFT"], createdBy: "u_leo", createdAt: "2026-07-04T00:00:00Z" },
  { id: "c_meme", slug: "meme-stocks", name: "meme stocks", emoji: "🐸", description: "for entertainment purposes. mostly.", tickers: ["GME", "AMC", "TSLA"], createdBy: "u_zoe", createdAt: "2026-07-05T00:00:00Z" },
];

export const seedMemberships: { communityId: string; userId: string }[] = [
  ...["u_priya", "u_maya", "u_nia", "u_leo", "u_jordan", "u_ellie", ME].map((userId) => ({ communityId: "c_tech", userId })),
  ...["u_alex", "u_ravi", "u_priya", "u_kai", "u_sam", ME].map((userId) => ({ communityId: "c_ai", userId })),
  ...["u_ravi", "u_alex", "u_maya", "u_ellie"].map((userId) => ({ communityId: "c_semis", userId })),
  ...["u_leo", "u_omar", "u_ellie", "u_maya"].map((userId) => ({ communityId: "c_long", userId })),
  ...["u_zoe", "u_kai", "u_sam"].map((userId) => ({ communityId: "c_meme", userId })),
];

// ---------- posts ----------

const t = (h: number) => new Date(new Date(SEED_NOW).getTime() - h * 3600e3).toISOString();
const op = (id: string, authorId: string, h: number, pick: string, versus: string, horizon: string, body: string, communityId?: string): Post => ({
  id, authorId, createdAt: t(h), kind: "opinion", body, prediction: { pick, versus, horizon }, tickers: [pick, versus], communityId,
});
const tx = (id: string, authorId: string, h: number, body: string, tickers: string[], communityId?: string): Post => ({
  id, authorId, createdAt: t(h), kind: "text", body, tickers, communityId,
});
const dp = (id: string, authorId: string, h: number, duelId: string, body: string, kind: "duel" | "result" = "duel"): Post => ({
  id, authorId, createdAt: t(h), kind, body, duelId, tickers: [],
});

export const seedPosts: Post[] = [
  op("p1", "u_alex", 0.4, "NVDA", "MSFT", "this month", "i think nvda will outperform msft this month. data center capex isn't slowing down.", "c_ai"),
  dp("p2", "u_nia", 1.2, "d_live4", "put $10 on meta vs googl with @leolongterm. reels > search. fight me."),
  op("p3", "u_maya", 2, "AAPL", "TSLA", "this week", "aapl quietly outperforms tsla this week. nobody's ready for the services numbers."),
  dp("p4", "u_maya", 3, "d_rise", "lost to @alexrivers. nvda +5% vs my aapl +3%. respect. rematch is already live.", "result"),
  tx("p5", "u_priya", 4, "amzn chart looks like a staircase. not financial advice, just geometry.", ["AMZN"], "c_tech"),
  dp("p6", "u_kai", 4.5, "d_acc", "gme vs amc. me vs @zoe.memes. the meme civil war starts at the close.", "duel"),
  op("p7", "u_leo", 5, "KO", "DIS", "this quarter", "ko over dis this quarter. boring wins.", "c_long"),
  dp("p8", "u_priya", 6, "d_draw", "msft +3.00% vs googl +3.00%. an actual dead heat with @leolongterm. stakes back.", "result"),
  op("p9", "u_ravi", 7, "TSM", "AMD", "this month", "tsm is the toll road. amd is a car on it. tsm beats amd this month.", "c_semis"),
  tx("p10", "u_omar", 8, "reminder that beef compares percentage returns, not share prices. a $3 stock can absolutely beat a $900 one.", []),
  op("p11", "u_sam", 9, "COIN", "PLTR", "2 weeks", "coin over pltr. already put $20 on it vs @alexrivers."),
  dp("p12", "u_nia", 10, "d_fall", "both fell. meta fell less (−2% vs tsla −5%). still counts. thanks @samtrades 🙏", "result"),
  op("p13", "u_jordan", 11, "TSLA", "AAPL", "1 week", "tsla over aapl by friday. @demo you in?"),
  tx("p14", "u_ellie", 12, "dca update: bought more msft, aapl, amzn. no beef today, just vibes.", ["MSFT", "AAPL", "AMZN"]),
  op("p15", "u_zoe", 13, "AMC", "GME", "1 week", "amc will outperform gme. i've said this every week for 3 years. one day.", "c_meme"),
  dp("p16", "u_ravi", 14, "d_group", "semis showdown is done. 4 of us, 4 chips. results inside.", "result"),
  op("p17", "u_priya", 16, "AMZN", "COST", "1 month", "amzn beats cost over the month. i'm on the other side of @mayabuys."),
  tx("p18", "u_kai", 18, "smci duel is paused bc of a trading halt in the data. no winner till prices are verified. respect the process i guess.", ["SMCI"]),
  op("p19", "u_omar", 20, "JPM", "COIN", "1 month", "jpm over coin over a month. banks are back.", "c_long"),
  op("p20", "u_alex", 22, "PLTR", "COIN", "2 weeks", "pltr will cook coin. duel's live, $20 each.", "c_ai"),
  tx("p21", "u_leo", 26, "long-term community: what's one stock you'd hold for 10 years without checking?", [], "c_long"),
  op("p22", "u_nia", 30, "META", "NFLX", "this month", "meta over nflx this month. ad market's hot.", "c_tech"),
  op("p23", "u_ellie", 34, "MSFT", "GOOGL", "1 month", "msft over googl over a month. copilot seats are real revenue."),
  op("p25", ME, 26, "NVDA", "MSFT", "this week", "nvda over msft this week. put $10 on it vs @jordanj, let's see."),
  dp("p24", "u_omar", 40, "d_c7", "ko vs gme with @kaiyolo. boring vs chaos. results speak.", "result"),
];

// ---------- comments + reactions ----------

let cid = 0;
const cm = (targetType: "post" | "duel", targetId: string, authorId: string, h: number, body: string): Comment => ({
  id: `cm${++cid}`, targetType, targetId, authorId, body, createdAt: t(h),
});

export const seedComments: Comment[] = [
  cm("post", "p1", "u_ellie", 0.3, "msft has copilot though. i'll take that side."),
  cm("post", "p1", "u_ravi", 0.2, "nvda all day. the supply chain says so."),
  cm("post", "p2", "u_leo", 1, "search prints money. see you at the close."),
  cm("post", "p2", "u_priya", 0.9, "grabbing popcorn"),
  cm("post", "p3", "u_jordan", 1.5, "bold. tsla deliveries say otherwise."),
  cm("post", "p4", "u_alex", 2.5, "gg. rematch is already looking rough for me lol"),
  cm("post", "p6", "u_zoe", 4, "amc to the moon (please)"),
  cm("post", "p8", "u_omar", 5, "a true draw. beautiful."),
  cm("post", "p8", "u_maya", 5.5, "wait how? different prices?"),
  cm("post", "p8", "u_priya", 5.4, "percent returns! 400→412 and 150→154.50 are both +3%."),
  cm("post", "p9", "u_alex", 6, "tsm is the toll road but nvda owns the cars"),
  cm("post", "p10", "u_kai", 7, "this is why i keep picking gme"),
  cm("post", "p12", "u_sam", 9, "painful week. tsla owes me"),
  cm("post", "p13", ME, 10, "considering it 👀"),
  cm("post", "p15", "u_kai", 12, "zoe never gives up. respect."),
  cm("post", "p16", "u_ellie", 13, "avgo let me down"),
  cm("post", "p18", "u_ravi", 17, "honestly good that it doesn't just guess."),
  cm("post", "p21", "u_omar", 25, "costco. membership fees are a moat."),
  cm("post", "p21", "u_ellie", 24, "msft for me"),
  cm("duel", "d_live1", "u_jordan", 5, "msft is steady. nvda can't keep this up."),
  cm("duel", "d_live1", ME, 4, "we'll see on friday"),
  cm("duel", "d_live2", "u_sam", 20, "coin is so back"),
  cm("duel", "d_live2", "u_alex", 19, "pltr chart says no"),
  cm("duel", "d_rise", "u_maya", 300, "i'll be back"),
  cm("duel", "d_live4", "u_leo", 1, "may the best ad business win"),
];

const reactionKinds: ReactionKind[] = ["fire", "bull", "bear", "laugh", "clap"];
export const seedReactions: Reaction[] = (() => {
  const out: Reaction[] = [];
  const users = seedUsers.map((x) => x.id).filter((x) => x !== ME);
  seedPosts.forEach((p, i) => {
    const n = 3 + ((i * 7) % 9);
    for (let k = 0; k < n; k++) {
      out.push({ targetType: "post", targetId: p.id, userId: users[(i + k) % users.length], kind: reactionKinds[(i + k) % reactionKinds.length] });
    }
  });
  ["d_live1", "d_live2", "d_live4", "d_rise", "d_fall", "d_draw"].forEach((d, i) => {
    for (let k = 0; k < 4 + i; k++) out.push({ targetType: "duel", targetId: d, userId: users[(k + i) % users.length], kind: reactionKinds[k % 5] });
  });
  // dedupe user+target
  const seen = new Set<string>();
  return out.filter((r) => { const key = `${r.targetType}:${r.targetId}:${r.userId}`; if (seen.has(key)) return false; seen.add(key); return true; });
})();

// ---------- follows ----------

export const seedFollows: { followerId: string; followeeId: string }[] = (() => {
  const ids = seedUsers.map((x) => x.id);
  const out: { followerId: string; followeeId: string }[] = [];
  ids.forEach((a, i) => ids.forEach((b, j) => {
    if (a !== b && (i * 3 + j * 5) % 4 !== 0) out.push({ followerId: a, followeeId: b });
  }));
  // demo account follows a curated few
  return out.filter((f) => f.followerId !== ME).concat(
    ["u_alex", "u_maya", "u_jordan", "u_priya", "u_nia"].map((followeeId) => ({ followerId: ME, followeeId })),
  );
})();

// ---------- notifications ----------

let nid = 0;
const nt = (kind: Notification["kind"], h: number, text: string, href: string, actorId?: string, read = false): Notification => ({
  id: `n${++nid}`, userId: ME, kind, text, href, actorId, createdAt: t(h), read,
});

export const seedNotifications: Notification[] = [
  nt("duel_invite", 2.8, "challenged you: tsla vs aapl, $10 each, 1 week", "/duel/d_inv", "u_jordan"),
  nt("duel_invite", 6, "challenged you: gme vs msft, $5 each, 1 week", "/duel/d_inv2", "u_kai"),
  nt("comment", 5, "commented on your duel: “msft is steady. nvda can't keep this up.”", "/duel/d_live1", "u_jordan"),
  nt("reaction", 6, "reacted 🔥 to your duel vs @jordanj", "/duel/d_live1", "u_nia"),
  nt("follow", 9, "started following you", "/u/ravisemis", "u_ravi"),
  nt("duel_active", 49, "your duel vs @jordanj is live. starting prices locked at the close.", "/duel/d_live1", "u_jordan", true),
  nt("duel_completed", 120, "you beat @mayabuys. meta vs aapl is settled.", "/duel/d_c6", "u_maya", true),
  nt("duel_completed", 190, "nvda vs tsla with @alexrivers is settled.", "/duel/d_c5", "u_alex", true),
  nt("rivalry", 100, "your rivalry with @alexrivers is heating up", "/rivalry/alexrivers", "u_alex", true),
  nt("community", 30, "new public challenge in ai stocks", "/communities/ai-stocks", "u_alex", true),
  nt("achievement", 190, "unlocked “first beef” 🥩", "/profile", undefined, true),
];

// ---------- daily beef ----------

export function dailyMatchup(session: string): [string, string] {
  const pairs: [string, string][] = [["NVDA", "AMD"], ["AAPL", "MSFT"], ["TSLA", "AMZN"], ["META", "GOOGL"], ["NFLX", "DIS"], ["COIN", "PLTR"], ["COST", "KO"]];
  const n = session.split("-").reduce((a, b) => a + Number(b), 0);
  return pairs[n % pairs.length];
}

export const seedDaily: DailyBeef[] = (() => {
  const out: DailyBeef[] = [];
  let s = lastCloseAtOrBefore(new Date(SEED_NOW));
  const users = seedUsers.filter((x) => x.id !== ME).map((x) => x.id);
  for (let i = 0; i < 6; i++) {
    const [a, b] = dailyMatchup(s);
    const picks: Record<string, string> = {};
    users.forEach((uid, k) => { picks[uid] = (k + i) % 3 === 0 ? b : a; });
    if (i > 0 && i < 5) picks[ME] = i % 2 ? a : b;
    out.push({ id: s, session: s, a, b, picks });
    s = prevTradingDay(s);
  }
  return out;
})();

export const seedTransactions: SimTransaction[] = [
  { id: "sim_faucet", userId: ME, kind: "faucet", amount: 100, createdAt: "2026-11-01T12:00:00Z", state: "simulated" },
];
