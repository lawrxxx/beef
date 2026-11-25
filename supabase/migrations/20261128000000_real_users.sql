-- real users only, funded with base sepolia test usdc.
-- 1. no generated usernames: a profile exists only once the user picks a username.
-- 2. duels are funded onchain; the database mirrors verified escrow events.
-- 3. accepting a duel happens only after the server verified the onchain join.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

alter table profiles add column if not exists referred_by uuid references profiles(id) on delete set null;

-- usernames are chosen by people. availability check (callable before a profile exists)
create or replace function username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(p_username) ~ '^[a-z0-9._]{3,20}$'
    and lower(p_username) not in ('admin', 'beef', 'support', 'help', 'root', 'system', 'official', 'moderator', 'mod', 'staff', 'team', 'null', 'undefined', 'me', 'you')
    and not exists (select 1 from profiles where username = lower(p_username));
$$;
grant execute on function username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- duels funded with test usdc on base sepolia
-- ---------------------------------------------------------------------------
drop policy if exists "create duel" on duels;
alter table duels drop constraint if exists duels_simulated_funds_check;
alter table duels drop column if exists simulated_funds;
alter table duels add column if not exists funding text not null default 'base_sepolia_usdc' check (funding = 'base_sepolia_usdc');
alter table duels add column if not exists escrow_state text not null default 'unfunded'
  check (escrow_state in ('unfunded', 'funded', 'active', 'settled', 'refunded'));
alter table duels add column if not exists funded_at timestamptz;
alter table duels add column if not exists escrow_tx text;
alter table duel_participants add column if not exists join_tx text;

-- stakes are whole test usdc between 1 and 25 (the escrow's limit)
alter table duels drop constraint if exists duels_stake_check;
alter table duels add constraint duels_stake_check check (stake >= 1 and stake <= 25);

create policy "create duel" on duels for insert with check (
  created_by = auth.uid() and status = 'pending' and escrow_state = 'unfunded' and funded_at is null and escrow_tx is null
);

-- users can no longer accept directly: the server accepts on their behalf after it has
-- verified their onchain join (escrow `Joined` event) in a mined receipt.
revoke execute on function accept_duel(uuid) from authenticated;

create or replace function accept_duel_for(p_duel uuid, p_user uuid, p_tx text) returns duel_status
language plpgsql security definer set search_path = public as $$
declare
  d duels%rowtype;
  slot text;
  remaining int;
begin
  select * into d from duels where id = p_duel for update;
  if not found then raise exception 'duel not found'; end if;
  if d.status <> 'pending' then raise exception 'duel is %', d.status; end if;
  if d.escrow_state not in ('funded') then raise exception 'creator stake not locked'; end if;
  select ticker into slot from duel_participants where duel_id = d.id and user_id = p_user and not accepted;
  if slot is null and d.is_open and not exists (select 1 from duel_participants where duel_id = d.id and user_id = p_user) then
    select ticker into slot from duel_participants where duel_id = d.id and user_id is null limit 1;
  end if;
  if slot is null then raise exception 'no open slot for this user'; end if;
  update duel_participants set user_id = p_user, accepted = true, accepted_at = now(), join_tx = p_tx
    where duel_id = d.id and ticker = slot;
  select count(*) into remaining from duel_participants where duel_id = d.id and not accepted;
  if remaining = 0 then
    update duels set status = 'accepted', escrow_state = 'active' where id = d.id;
    return 'accepted';
  end if;
  return 'pending';
end $$;
revoke all on function accept_duel_for(uuid, uuid, text) from public, anon, authenticated;
grant execute on function accept_duel_for(uuid, uuid, text) to service_role;

-- verified escrow state changes, applied by the server (service role) only
create or replace function set_escrow_state(p_duel uuid, p_state text, p_tx text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update duels set
    escrow_state = p_state,
    funded_at = case when p_state = 'funded' then now() else funded_at end,
    escrow_tx = case when p_state = 'funded' then p_tx else escrow_tx end
  where id = p_duel;
end $$;
revoke all on function set_escrow_state(uuid, text, text) from public, anon, authenticated;
grant execute on function set_escrow_state(uuid, text, text) to service_role;

-- the duel guard trigger blocks updates to completed duels; allow escrow bookkeeping
-- (payout / refund) to be recorded after completion, and nothing else.
create or replace function guard_duel_update() returns trigger language plpgsql as $$
begin
  if old.status = 'completed' then
    if (to_jsonb(new) - 'escrow_state') = (to_jsonb(old) - 'escrow_state') and new.escrow_state in ('settled', 'refunded') then
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

-- realtime for wallet activity (rls: owner only)
alter publication supabase_realtime add table wallet_intents;
