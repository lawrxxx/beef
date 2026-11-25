import type { Duel, User } from "@/lib/types";

export interface UserStats {
  completed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 0-100
  streak: number; // current winning streak
  bestStreak: number;
  active: number;
  activity: number; // posts + comments + picks
  score: number;
}

/** a user's outcome in a settled duel */
export function outcomeFor(d: Duel, userId: string): "win" | "loss" | "draw" | null {
  if (d.status !== "completed" || !d.settlement) return null;
  if (!d.participants.some((p) => p.userId === userId)) return null;
  if (d.settlement.status === "draw") return "draw";
  return d.settlement.winners.includes(userId) ? "win" : "loss";
}

/**
 * beef score. rewards consistency and participation, not risk:
 * - win rate is shrunk toward 50% until you have a real sample (bayesian)
 * - completed duels, streaks and community activity are capped
 * - stake size is deliberately ignored so bigger bets never mean a bigger score
 */
export function beefScore(s: Omit<UserStats, "score">): number {
  const bayes = (s.wins + 0.5 * s.draws + 3) / (s.completed + 6);
  const skill = (bayes - 0.5) * 1200;
  const experience = 6 * Math.min(s.completed, 150);
  const streak = 15 * Math.min(s.bestStreak, 10);
  const community = Math.min(s.activity, 200);
  return Math.max(0, Math.round(1000 + skill + experience + streak + community));
}

export function computeStats(userId: string, duels: Duel[], activity: number, user?: User): UserStats {
  const mine = duels
    .filter((d) => d.participants.some((p) => p.userId === userId))
    .sort((a, b) => (a.settlement?.settledAt ?? a.deadline).localeCompare(b.settlement?.settledAt ?? b.deadline));
  let wins = 0, losses = 0, draws = 0, streak = 0, bestStreak = 0, active = 0;
  for (const d of mine) {
    if (["active", "accepted", "pending", "awaiting_verification"].includes(d.status)) active++;
    const o = outcomeFor(d, userId);
    if (o === "win") { wins++; streak++; bestStreak = Math.max(bestStreak, streak); }
    else if (o === "loss") { losses++; streak = 0; }
    else if (o === "draw") { draws++; }
  }
  // seeded history (users who have been around longer than the demo data)
  const hist = user?.monthly;
  if (hist && userId !== "u_me") {
    wins += hist.wins * 2; losses += hist.losses * 2; draws += hist.draws;
    bestStreak = Math.max(bestStreak, Math.min(hist.wins, 9));
  }
  const completed = wins + losses + draws;
  const winRate = completed ? (wins / completed) * 100 : 0;
  const base = { completed, wins, losses, draws, winRate, streak, bestStreak, active, activity };
  return { ...base, score: beefScore(base) };
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  test: (s: UserStats, extra: { posts: number; comments: number; communities: number; correctPicks: number }) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_duel", name: "first beef", description: "complete your first duel", emoji: "🥩", test: (s) => s.completed >= 1 },
  { id: "five_wins", name: "high five", description: "win five duels", emoji: "🖐️", test: (s) => s.wins >= 5 },
  { id: "ten_duels", name: "regular", description: "complete ten duels", emoji: "🔟", test: (s) => s.completed >= 10 },
  { id: "streak_3", name: "heating up", description: "win three in a row", emoji: "🔥", test: (s) => s.bestStreak >= 3 },
  { id: "streak_5", name: "on a heater", description: "win five in a row", emoji: "☄️", test: (s) => s.bestStreak >= 5 },
  { id: "oracle", name: "called it", description: "get three daily beef picks right", emoji: "🔮", test: (_s, e) => e.correctPicks >= 3 },
  { id: "voice", name: "loud and clear", description: "publish five opinions", emoji: "📣", test: (_s, e) => e.posts >= 5 },
  { id: "community", name: "joiner", description: "join three communities", emoji: "🤝", test: (_s, e) => e.communities >= 3 },
  { id: "commenter", name: "in the replies", description: "leave ten comments", emoji: "💬", test: (_s, e) => e.comments >= 10 },
];
