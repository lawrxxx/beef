"use client";

import Link from "next/link";
import { useState } from "react";
import { TrendingUp, X } from "lucide-react";
import { createPost } from "@/lib/store/store";
import { useMe } from "@/lib/hooks";
import { ASSETS } from "@/lib/market/assets";
import { Avatar, useAction } from "@/components/ui";
import { cx } from "@/lib/format";

const HORIZONS = ["today", "this week", "this month", "this quarter"];

export function Composer({ communityId, onPosted }: { communityId?: string; onPosted?: () => void }) {
  const me = useMe();
  const run = useAction();
  const [body, setBody] = useState("");
  const [predict, setPredict] = useState(false);
  const [pick, setPick] = useState("NVDA");
  const [versus, setVersus] = useState("AAPL");
  const [horizon, setHorizon] = useState("this week");

  if (!me) {
    return (
      <div className="card flex items-center justify-between gap-3 p-4">
        <p className="text-[15px] text-ink-soft">got a hot take? sign in to post it.</p>
        <Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>
      </div>
    );
  }

  const submit = async () => {
    const ok = await run(() => {
      createPost({
        body: body.trim() || (predict ? `i think ${pick.toLowerCase()} will outperform ${versus.toLowerCase()} ${horizon}.` : ""),
        kind: predict ? "opinion" : "text",
        prediction: predict ? { pick, versus, horizon } : undefined,
        communityId,
      });
      return true;
    }, predict ? "prediction posted" : "posted");
    if (ok) { setBody(""); setPredict(false); onPosted?.(); }
  };

  return (
    <div className="border-b border-line py-4">
      <div className="flex gap-3">
        <Avatar user={me} size={40} />
        <textarea
          className="min-h-[52px] w-full resize-none bg-transparent pt-2 text-[16px] placeholder:text-faint focus:outline-none"
          placeholder={predict ? "why? (optional)" : "what's your stock take?"}
          value={body}
          maxLength={500}
          onChange={(e) => setBody(e.target.value)}
          aria-label="post text"
        />
      </div>
      {predict && (
        <div className="mt-3 border-l-[3px] border-brand bg-sunken/50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">prediction</p>
            <button className="btn-ghost btn-sm !h-8 !px-2" onClick={() => setPredict(false)} aria-label="remove prediction"><X size={16} /></button>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select className="input !py-2.5" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="stock you think wins">
              {ASSETS.filter((a) => a.ticker !== versus).map((a) => <option key={a.ticker} value={a.ticker}>{a.ticker}</option>)}
            </select>
            <span className="text-sm text-muted">beats</span>
            <select className="input !py-2.5" value={versus} onChange={(e) => setVersus(e.target.value)} aria-label="stock you think loses">
              {ASSETS.filter((a) => a.ticker !== pick).map((a) => <option key={a.ticker} value={a.ticker}>{a.ticker}</option>)}
            </select>
          </div>
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            {HORIZONS.map((h) => <button key={h} className={cx("chip shrink-0 !py-1", horizon === h && "chip-active")} onClick={() => setHorizon(h)}>{h}</button>)}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <button className={cx("chip", predict && "chip-active")} onClick={() => setPredict((p) => !p)}>
          <TrendingUp size={15} /> make it a prediction
        </button>
        <div className="flex items-center gap-2">
          <span className="num text-xs text-faint">{body.length}/500</span>
          <button className="btn-dark btn-sm" disabled={!predict && !body.trim()} onClick={submit}>post</button>
        </div>
      </div>
    </div>
  );
}
