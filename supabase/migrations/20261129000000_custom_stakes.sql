-- custom stakes: any amount in whole cents between the configured limits.
-- keep these numbers in step with NEXT_PUBLIC_STAKE_MIN_USDC / NEXT_PUBLIC_STAKE_MAX_USDC
-- and the deployed escrow's minStake / maxStake (defaults: 1 to 1000 test usdc).
alter table duels drop constraint if exists duels_stake_check;
alter table duels add constraint duels_stake_check check (stake >= 1 and stake <= 1000 and stake = round(stake, 2));

-- invitations show the exact stake, e.g. "35.50 test usdc each"
create or replace function on_participant_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare d duels%rowtype; vs text;
begin
  select * into d from duels where id = new.duel_id;
  if new.accepted or new.user_id is null or new.user_id = d.created_by then return new; end if;
  select string_agg(lower(ticker), ' vs ') into vs from duel_participants where duel_id = new.duel_id;
  perform notify(new.user_id, d.created_by, 'duel_invite',
    'challenged you: ' || coalesce(vs, lower(new.ticker)) || ', ' || trim(to_char(d.stake, 'FM999999990.00')) || ' test usdc each, ' || d.deadline_label,
    '/duel/' || d.id);
  return new;
end $$;
