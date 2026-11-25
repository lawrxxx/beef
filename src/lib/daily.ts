/** beef of the day: one deterministic matchup per trading session */
export function dailyMatchup(session: string): [string, string] {
  const pairs: [string, string][] = [["NVDA", "AMD"], ["AAPL", "MSFT"], ["TSLA", "AMZN"], ["META", "GOOGL"], ["NFLX", "DIS"], ["COIN", "PLTR"], ["COST", "KO"]];
  const n = session.split("-").reduce((a, b) => a + Number(b), 0);
  return pairs[n % pairs.length];
}
