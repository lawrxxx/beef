-- chainlink data streams as the stock price oracle.
-- price_streams: verified stream config, written only by discovery (service role).
-- price_reports: every signed report a lock or settlement used, append-only, for audit.
-- corporate_actions: recorded splits used to adjust starting prices (service role only).
-- snapshots gain the chainlink evidence (stream, timestamps, status, report hash, verification).

create table price_streams (
  network text not null check (network in ('testnet', 'mainnet')),
  ticker text not null references stock_assets(ticker),
  session text not null check (session in ('regular', 'extended', 'overnight')),
  stream_id text not null check (stream_id ~ '^0x000b[0-9a-f]{60}$'), -- rwa advanced (v11)
  name text not null,
  schema text not null default 'v11' check (schema = 'v11'),
  decimals int not null default 18 check (decimals = 18),
  verifier text not null,
  discovered_at timestamptz not null default now(),
  primary key (network, ticker, session),
  unique (network, stream_id)
);
alter table price_streams enable row level security;
create policy "streams visible" on price_streams for select using (true);

create table price_reports (
  id bigint generated always as identity primary key,
  report_hash text not null unique check (report_hash ~ '^0x[0-9a-f]{64}$'),
  ticker text not null,
  stream_id text not null,
  purpose text not null check (purpose in ('live', 'reference')),
  session date,
  reference_ts bigint,
  observations_ts bigint not null,
  valid_from_ts bigint,
  expires_at bigint,
  market_status int not null,
  mid numeric(78, 0) not null,
  bid numeric(78, 0),
  ask numeric(78, 0),
  last_traded numeric(78, 0),
  last_seen_ns numeric(30, 0),
  full_report text not null,           -- the original signed report, exactly as chainlink sent it
  verification jsonb,                  -- result from chainlink's base sepolia verifier proxy
  recorded_at timestamptz not null default now()
);
create index price_reports_stream_idx on price_reports(stream_id, observations_ts);
alter table price_reports enable row level security; -- service role only
create trigger price_reports_append_only before update or delete on price_reports for each row execute function forbid_change();

create table corporate_actions (
  ticker text not null references stock_assets(ticker),
  session date not null,                 -- first session trading on the new basis
  ratio_num int not null check (ratio_num > 0), -- shares after = shares before × num / den
  ratio_den int not null check (ratio_den > 0),
  note text,
  created_at timestamptz not null default now(),
  primary key (ticker, session)
);
alter table corporate_actions enable row level security;
create policy "corporate actions visible" on corporate_actions for select using (true);

alter table duel_price_snapshots
  add column price_e18 numeric(78, 0),
  add column adjusted_e18 numeric(78, 0),
  add column stream_id text,
  add column observations_ts bigint,
  add column market_status int,
  add column report_hash text,
  add column verification jsonb;
-- chainlink prices can exceed the old numeric(14,4) display column's precision rules
alter table duel_price_snapshots alter column price type numeric(20, 6);
alter table duel_price_snapshots alter column adjusted_price type numeric(20, 6);

-- the escrow payout transaction (settle) is recorded separately from the funding tx
alter table duels add column if not exists settle_tx text;

create or replace function set_escrow_state(p_duel uuid, p_state text, p_tx text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_state not in ('funded', 'active', 'settled', 'refunded') then raise exception 'bad state'; end if;
  update duels set
    escrow_state = p_state,
    funded_at = case when p_state = 'funded' then coalesce(funded_at, now()) else funded_at end,
    escrow_tx = case when p_state in ('funded', 'active') then coalesce(escrow_tx, p_tx) else escrow_tx end,
    settle_tx = case when p_state in ('settled', 'refunded') then coalesce(settle_tx, p_tx) else settle_tx end
  where id = p_duel;
end $$;
revoke all on function set_escrow_state(uuid, text, text) from public, anon, authenticated;
grant execute on function set_escrow_state(uuid, text, text) to service_role;

-- completed duels stay frozen except for the escrow outcome recorded after the payout
create or replace function guard_duel_update() returns trigger language plpgsql as $$
begin
  if old.status = 'completed' then
    if (to_jsonb(new) - 'escrow_state' - 'settle_tx') = (to_jsonb(old) - 'escrow_state' - 'settle_tx') and new.escrow_state in ('settled', 'refunded') then
      return new;
    end if;
    raise exception 'completed duels cannot be modified';
  end if;
  if old.status <> 'pending' and (
    new.stake is distinct from old.stake or new.deadline is distinct from old.deadline or
    new.methodology is distinct from old.methodology or new.provider is distinct from old.provider or
    new.price_rule is distinct from old.price_rule or new.settlement_rule is distinct from old.settlement_rule or
    new.calculation_version is distinct from old.calculation_version
  ) then
    raise exception 'duel terms are locked once accepted';
  end if;
  return new;
end $$;

-- new duels record the chainlink methodology and calculation version by default
alter table duels alter column methodology set default 'chainlink_regular_hours_mid_v1';
alter table duels alter column provider set default 'chainlink-data-streams';
alter table duels alter column calculation_version set default 'pct-return-v2';
