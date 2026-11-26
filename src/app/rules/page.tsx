
export const metadata = { title: "how beef works" };

const RULES: [string, string][] = [
  ["higher percentage return", "wins"],
  ["both stocks go up", "the bigger gain wins"],
  ["both stocks go down", "the smaller loss wins"],
  ["identical returns (to 0.0001 pts)", "draw, stakes returned"],
  ["deadline on a weekend or holiday", "last official close at or before the deadline. if that isn't after the price lock, the next trading session"],
  ["early-close days", "the 1:00pm et official close is used"],
  ["price source", "chainlink data streams, 24/5 us equities regular-hours stream (mid price)"],
  ["exact price time", "the report observed one second before the official close"],
  ["report not verified by chainlink's verifier", "settlement pauses for verification"],
  ["missing report, market status not regular hours, or a stale mid (possible halt)", "settlement pauses. no winner until it's resolved"],
  ["crossed or unusually wide quote", "settlement pauses for verification"],
  ["stock split during the duel", "the starting price is adjusted by the recorded split ratio. an unexplained move of 40% or more pauses settlement"],
];

export default function RulesPage() {
  return (
    <div className="prose-sm max-w-none">
      <h1 className="font-display text-[26px] font-bold tracking-tight">how beef works</h1>
      <p className="mt-1 text-[15px] text-muted">the short version: pick a stock, pick a rival's stock, see whose goes up more (or down less).</p>

      <section className="card mt-5 p-5">
        <h2 className="text-lg font-bold">the formula</h2>
        <p className="mt-2 rounded-xl bg-black/[.04] p-3 font-mono text-sm">return = ((ending price − starting price) ÷ starting price) × 100</p>
        <p className="mt-3 text-[15px] text-ink-soft">beef always compares <b>percentage returns</b>, never share prices or dollar gains. a $180 stock and a $250 stock compete on equal terms.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3 text-sm">
            <p className="font-semibold">example: both rise</p>
            <p className="mt-1 text-ink-soft">nvda $180 → $189 = <b className="text-gain">+5.00%</b><br />aapl $250 → $257.50 = <b className="text-gain">+3.00%</b></p>
            <p className="mt-1 text-muted">nvda wins by 2.00 percentage points, even though aapl's share price is higher.</p>
          </div>
          <div className="rounded-xl border p-3 text-sm">
            <p className="font-semibold">example: both fall</p>
            <p className="mt-1 text-ink-soft">nvda = <b className="text-loss">−5.00%</b><br />aapl = <b className="text-loss">−2.00%</b></p>
            <p className="mt-1 text-muted">aapl wins. it lost less.</p>
          </div>
        </div>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-lg font-bold">timing</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] text-ink-soft">
          <li>both sides agree to the exact same terms. once everyone's in, terms can't be edited.</li>
          <li><b>starting prices</b> lock at the first official market close after the last acceptance: the chainlink regular-hours mid one second before that close. nobody can enter a duel knowing today's move.</li>
          <li><b>ending prices</b> use the same rule on the deadline session.</li>
          <li>live prices during a duel switch between chainlink's regular, extended and overnight streams by market status. they're for display only and never decide the result.</li>
          <li>both stocks always use exactly the same window.</li>
          <li>times are stored in utc and shown in new york time (et), the market's timezone.</li>
        </ul>
      </section>

      <section className="card mt-4 overflow-hidden">
        <h2 className="px-5 pt-5 text-lg font-bold">settlement rules</h2>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y">
            {RULES.map(([k, v]) => <tr key={k}><td className="w-1/2 px-5 py-2.5 font-medium">{k}</td><td className="px-5 py-2.5 text-ink-soft">{v}</td></tr>)}
          </tbody>
        </table>
        <p className="px-5 py-4 text-[13px] text-muted">the winner is calculated only by beef's server-side settlement service, using prices it retrieves itself. the app never decides a winner, results are recorded once (idempotent), and every decision is written to an audit log.</p>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-lg font-bold">beef score</h2>
        <p className="mt-2 text-[15px] text-ink-soft">your score grows with consistent results: win rate (weighted by how many duels you've played), completed duels, streaks and community activity. stake size is ignored on purpose. bigger bets never mean a better rank.</p>
      </section>

      <section id="risk" className="card mt-4 border-gold/40 p-5">
        <h2 className="text-lg font-bold">risk disclosure & eligibility</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] text-ink-soft">
          <li>stakes are <b>test usdc on base sepolia</b>, a testnet token with no monetary value, held by the beef escrow contract. stock prices come from <b>chainlink data streams</b> (24/5 us equities); settlement uses regular-hours reports verified with chainlink's verifier on base sepolia. no real money moves.</li>
          <li>beef is entertainment, not investment advice. past results don't predict future returns.</li>
          <li>you must be 18 or older. real-money features, if ever offered, will only be available where they are legal and after identity and eligibility checks.</li>
          <li>real-money staking and tokenized stock transfers stay disabled until regulatory requirements, asset permissions, custody and oracle verification are confirmed.</li>
          <li>compete with friends for fun. never stake money you can't afford to lose.</li>
        </ul>
      </section>
      <p className="mt-6 text-center text-xs text-faint">calculation version pct-return-v1</p>
    </div>
  );
}
