-- duel expiration redesign: next market open / one week / custom, resolved with chainlink
-- data feeds at market opens. starting prices lock at start_at (the first market open after
-- activation); ending prices at deadline. all timestamps utc.

alter table duels add column if not exists expiration_type text check (expiration_type in ('next_open', 'one_week', 'custom'));
alter table duels add column if not exists start_at timestamptz;

-- chainlink feed evidence per snapshot (feed address is stream_id; updatedAt is observations_ts)
alter table duel_price_snapshots
  add column if not exists round_id text,
  add column if not exists answer numeric(78, 0),
  add column if not exists decimals int,
  add column if not exists read_block bigint;

-- terms stay frozen once accepted, except that activation fixes the schedule exactly once:
-- start_at, activated_at and (for next_open / one_week) the deadline, while start_at is still unset.
create or replace function guard_duel_update() returns trigger language plpgsql as $$
begin
  if old.status = 'completed' then
    if (to_jsonb(new) - 'escrow_state' - 'settle_tx') = (to_jsonb(old) - 'escrow_state' - 'settle_tx') and new.escrow_state in ('settled', 'refunded') then
      return new;
    end if;
    raise exception 'completed duels cannot be modified';
  end if;
  if old.start_at is not null and new.start_at is distinct from old.start_at then
    raise exception 'the duel schedule is fixed once it activates';
  end if;
  if old.status <> 'pending' and (
    new.stake is distinct from old.stake or
    (new.deadline is distinct from old.deadline and not (old.start_at is null and old.status = 'accepted')) or
    new.methodology is distinct from old.methodology or new.provider is distinct from old.provider or
    new.price_rule is distinct from old.price_rule or new.settlement_rule is distinct from old.settlement_rule or
    new.calculation_version is distinct from old.calculation_version or new.expiration_type is distinct from old.expiration_type
  ) then
    raise exception 'duel terms are locked once accepted';
  end if;
  return new;
end $$;

alter table duels alter column methodology set default 'chainlink_data_feeds_open_v2';
alter table duels alter column provider set default 'chainlink-data-feeds';
