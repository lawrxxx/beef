"use client";

import { DailyBeefCard, DailyHistory } from "@/components/daily-beef";
import { PageHeader, Section } from "@/components/ui";

export default function DailyPage() {
  return (
    <div>
      <PageHeader title="beef of the day" subtitle="one matchup a day. pick a side before the market opens." />
      <DailyBeefCard />
      <p className="mt-3 text-[13px] text-muted">picks close at the 9:30am et open. the winner has the higher return from the previous official close to that day's close. no stakes, just bragging rights (and the “called it” badge).</p>
      <Section title="past results" className="mt-6"><DailyHistory /></Section>
    </div>
  );
}
