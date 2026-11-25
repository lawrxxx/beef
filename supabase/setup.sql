-- beef: full database setup for a new supabase project (all migrations in order, then reference data).
-- paste into supabase → sql editor → run, once. generated from supabase/migrations + supabase/seed.sql.

-- ===== supabase/migrations/20261125000000_beef_schema.sql =====
-- beef schema
-- money is simulated in this version. settlement writes happen only through the
-- service role (server-side settlement service); clients can never write prices,
-- results or audit records.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
create type duel_status as enum ('pending','accepted','active','awaiting_verification','completed','cancelled','declined','expired');
create type duel_visibility as enum ('public','friends','private');
create type reaction_kind as enum ('fire','bull','bear','laugh','clap');
create type post_kind as enum ('opinion','duel','result','text');
create type snapshot_kind as enum ('start','end');
create type settlement_status as enum ('settled','draw','needs_verification');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key,                         -- = auth.users.id
  username citext not null unique check (username ~ '^[a-z0-9._]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text,
  avatar_emoji text default '🧑‍🍳',
  avatar_color text default '#FDE7D9' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  favorite_stocks text[] not null default '{}' check (cardinality(favorite_stocks) <= 5),
  is_adult boolean not null default false,
  country text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- create a profile automatically on sign up
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, display_name)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10), split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- market reference data
-- ---------------------------------------------------------------------------
create table stock_assets (
  ticker text primary key check (ticker ~ '^[A-Z.]{1,6}$'),
  name text not null,
  sector text not null,
  tokenized boolean not null default false,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- communities
-- ---------------------------------------------------------------------------
create table communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 3 and 40),
  description text not null default '' check (char_length(description) <= 200),
  emoji text not null default '💬',
  tickers text[] not null default '{}',
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table community_members (
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on community_members(user_id);

-- ---------------------------------------------------------------------------
-- duels
-- ---------------------------------------------------------------------------
create table duels (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id) on delete restrict,
  title text check (char_length(title) <= 50),
  stake numeric(10,2) not null check (stake > 0 and stake <= 25),
  visibility duel_visibility not null default 'public',
  is_open boolean not null default false,
  status duel_status not null default 'pending',
  deadline timestamptz not null,
  deadline_label text not null,
  invite_expires_at timestamptz not null,
  lock_at timestamptz,
  activated_at timestamptz,
  community_id uuid references communities(id) on delete set null,
  featured boolean not null default false,
  -- terms recorded at creation, immutable once accepted
  methodology text not null default 'percent_return_official_close',
  provider text not null default 'mock',
  market_timezone text not null default 'America/New_York',
  price_rule text not null,
  settlement_rule text not null,
  calculation_version text not null default 'pct-return-v1',
  simulated_funds boolean not null default true check (simulated_funds), -- real money disabled at the schema level
  created_at timestamptz not null default now(),
  check (deadline > created_at)
);
create index duels_status_deadline_idx on duels(status, deadline);
create index duels_status_lock_idx on duels(status, lock_at);
create index duels_created_by_idx on duels(created_by);
create index duels_community_idx on duels(community_id);

create table duel_participants (
  duel_id uuid not null references duels(id) on delete cascade,
  user_id uuid references profiles(id) on delete restrict, -- null = open slot
  ticker text not null references stock_assets(ticker),
  accepted boolean not null default false,
  accepted_at timestamptz,
  primary key (duel_id, ticker),
  unique (duel_id, user_id)
);
create index duel_participants_user_idx on duel_participants(user_id);

create table duel_price_snapshots (
  id bigint generated always as identity primary key,
  duel_id uuid not null references duels(id) on delete cascade,
  ticker text not null references stock_assets(ticker),
  kind snapshot_kind not null,
  price numeric(14,4) not null check (price > 0),
  adjusted_price numeric(14,6),
  session date not null,
  price_timestamp timestamptz not null,
  source text not null,
  simulated boolean not null,
  recorded_at timestamptz not null default now(),
  unique (duel_id, ticker, kind)
);

create table duel_settlements (
  duel_id uuid primary key references duels(id) on delete cascade, -- one settlement per duel (idempotency)
  status settlement_status not null,
  winner_ids uuid[] not null default '{}',
  winning_ticker text,
  margin_pct numeric(12,6) not null default 0,
  calculation_version text not null,
  methodology text not null,
  source text not null,
  simulated boolean not null,
  start_session date not null,
  end_session date not null,
  explanation text not null,
  payload jsonb not null,           -- full settlement incl. per-entry returns
  settled_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table settlement_audit_logs (
  id bigint generated always as identity primary key,
  duel_id uuid not null references duels(id) on delete cascade,
  at timestamptz not null default now(),
  action text not null,
  detail text not null
);
create index settlement_audit_duel_idx on settlement_audit_logs(duel_id, at);

create table duel_comments (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references duels(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index duel_comments_duel_idx on duel_comments(duel_id, created_at);

create table duel_reactions (
  duel_id uuid not null references duels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind reaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);

-- ---------------------------------------------------------------------------
-- social
-- ---------------------------------------------------------------------------
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  kind post_kind not null default 'text',
  body text not null check (char_length(body) between 1 and 500),
  duel_id uuid references duels(id) on delete set null,
  community_id uuid references communities(id) on delete set null,
  tickers text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index posts_created_idx on posts(created_at desc);
create index posts_author_idx on posts(author_id, created_at desc);
create index posts_community_idx on posts(community_id, created_at desc);
create index posts_tickers_idx on posts using gin(tickers);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  pick text not null references stock_assets(ticker),
  versus text not null references stock_assets(ticker),
  horizon text not null,
  resolves_at timestamptz,
  correct boolean, -- set by the server when resolved
  check (pick <> versus)
);

create table post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on post_comments(post_id, created_at);

create table post_reactions (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind reaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows(followee_id);

-- head-to-head, maintained by the server after each settlement (user_a < user_b)
create table rivalries (
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  wins_a int not null default 0,
  wins_b int not null default 0,
  draws int not null default 0,
  total int not null default 0,
  streak_user uuid references profiles(id),
  streak_count int not null default 0,
  last_duel_id uuid references duels(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table achievements (
  id text primary key,
  name text not null,
  description text not null,
  emoji text not null
);

create table user_achievements (
  user_id uuid not null references profiles(id) on delete cascade,
  achievement_id text not null references achievements(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  kind text not null,
  text text not null,
  href text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, read, created_at desc);

create table daily_beefs (
  session date primary key,
  ticker_a text not null references stock_assets(ticker),
  ticker_b text not null references stock_assets(ticker)
);

create table daily_picks (
  session date not null references daily_beefs(session) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  ticker text not null references stock_assets(ticker),
  created_at timestamptz not null default now(),
  primary key (session, user_id)
);

-- ---------------------------------------------------------------------------
-- integrity triggers
-- ---------------------------------------------------------------------------

-- terms are frozen once a duel leaves 'pending'; completed duels are immutable.
create or replace function guard_duel_update() returns trigger language plpgsql as $$
begin
  if old.status = 'completed' then
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
create trigger duels_guard before update on duels for each row execute function guard_duel_update();

-- snapshots and settlements are append-only
create or replace function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger snapshots_append_only before update or delete on duel_price_snapshots for each row execute function forbid_change();
create trigger settlements_append_only before update or delete on duel_settlements for each row execute function forbid_change();
create trigger audit_append_only before update or delete on settlement_audit_logs for each row execute function forbid_change();

-- participants: once accepted, a slot can't be edited by clients
create or replace function guard_participant_update() returns trigger language plpgsql as $$
begin
  if old.accepted and (new.ticker is distinct from old.ticker or new.user_id is distinct from old.user_id) then
    raise exception 'accepted participants are locked';
  end if;
  return new;
end $$;
create trigger participants_guard before update on duel_participants for each row execute function guard_participant_update();

-- ---------------------------------------------------------------------------
-- rpc: accept a duel (atomic, checks the invite)
-- ---------------------------------------------------------------------------
create or replace function accept_duel(p_duel uuid) returns duel_status
language plpgsql security definer set search_path = public as $$
declare
  d duels%rowtype;
  me uuid := auth.uid();
  slot text;
  remaining int;
begin
  if me is null then raise exception 'sign in required'; end if;
  if not exists (select 1 from profiles where id = me and is_adult) then raise exception 'age confirmation required'; end if;
  select * into d from duels where id = p_duel for update;
  if not found then raise exception 'duel not found'; end if;
  if d.status <> 'pending' then raise exception 'duel is %', d.status; end if;
  if d.invite_expires_at < now() then
    update duels set status = 'expired' where id = d.id;
    raise exception 'invitation expired';
  end if;

  select ticker into slot from duel_participants where duel_id = d.id and user_id = me and not accepted;
  if slot is null and d.is_open and not exists (select 1 from duel_participants where duel_id = d.id and user_id = me) then
    select ticker into slot from duel_participants where duel_id = d.id and user_id is null limit 1;
  end if;
  if slot is null then raise exception 'no open slot for you in this duel'; end if;

  update duel_participants set user_id = me, accepted = true, accepted_at = now() where duel_id = d.id and ticker = slot;
  select count(*) into remaining from duel_participants where duel_id = d.id and not accepted;
  if remaining = 0 then
    -- lock_at (next official close) is computed by the server cron; mark accepted now
    update duels set status = 'accepted' where id = d.id;
    return 'accepted';
  end if;
  return 'pending';
end $$;

create or replace function decline_duel(p_duel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update duels set status = 'declined'
  where id = p_duel and status = 'pending'
    and exists (select 1 from duel_participants where duel_id = p_duel and user_id = auth.uid() and not accepted);
end $$;

create or replace function cancel_duel(p_duel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update duels set status = 'cancelled' where id = p_duel and status = 'pending' and created_by = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table stock_assets enable row level security;
alter table communities enable row level security;
alter table community_members enable row level security;
alter table duels enable row level security;
alter table duel_participants enable row level security;
alter table duel_price_snapshots enable row level security;
alter table duel_settlements enable row level security;
alter table settlement_audit_logs enable row level security;
alter table duel_comments enable row level security;
alter table duel_reactions enable row level security;
alter table posts enable row level security;
alter table predictions enable row level security;
alter table post_comments enable row level security;
alter table post_reactions enable row level security;
alter table follows enable row level security;
alter table rivalries enable row level security;
alter table achievements enable row level security;
alter table user_achievements enable row level security;
alter table notifications enable row level security;
alter table daily_beefs enable row level security;
alter table daily_picks enable row level security;

-- helper: can the current user see this duel?
create or replace function can_see_duel(p_duel uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from duels d where d.id = p_duel and (
      d.visibility = 'public'
      or d.created_by = auth.uid()
      or exists (select 1 from duel_participants p where p.duel_id = d.id and p.user_id = auth.uid())
      or (d.visibility = 'friends' and exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = d.created_by))
    )
  );
$$;

-- public reads
create policy "profiles readable" on profiles for select using (true);
create policy "own profile insert" on profiles for insert with check (id = auth.uid());
create policy "own profile update" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "assets readable" on stock_assets for select using (true);
create policy "achievements readable" on achievements for select using (true);
create policy "user achievements readable" on user_achievements for select using (true);
create policy "rivalries readable" on rivalries for select using (true);
create policy "daily readable" on daily_beefs for select using (true);

create policy "communities readable" on communities for select using (true);
create policy "create community" on communities for insert with check (created_by = auth.uid());
create policy "edit own community" on communities for update using (created_by = auth.uid());
create policy "members readable" on community_members for select using (true);
create policy "join" on community_members for insert with check (user_id = auth.uid());
create policy "leave" on community_members for delete using (user_id = auth.uid());

-- duels: create as yourself, everything else goes through rpc or the service role
create policy "duels visible" on duels for select using (can_see_duel(id));
create policy "create duel" on duels for insert with check (created_by = auth.uid() and status = 'pending' and simulated_funds);
create policy "participants visible" on duel_participants for select using (can_see_duel(duel_id));
create policy "creator adds participants" on duel_participants for insert with check (
  exists (select 1 from duels d where d.id = duel_id and d.created_by = auth.uid() and d.status = 'pending')
  and (accepted = false or user_id = auth.uid())
);

-- settlement data: read-only for clients. no insert/update/delete policies exist,
-- so only the service role (which bypasses rls) can write.
create policy "snapshots visible" on duel_price_snapshots for select using (can_see_duel(duel_id));
create policy "settlements visible" on duel_settlements for select using (can_see_duel(duel_id));
create policy "audit visible" on settlement_audit_logs for select using (can_see_duel(duel_id));

create policy "duel comments visible" on duel_comments for select using (can_see_duel(duel_id));
create policy "comment on duel" on duel_comments for insert with check (author_id = auth.uid() and can_see_duel(duel_id));
create policy "delete own duel comment" on duel_comments for delete using (author_id = auth.uid());
create policy "duel reactions visible" on duel_reactions for select using (can_see_duel(duel_id));
create policy "react to duel" on duel_reactions for insert with check (user_id = auth.uid() and can_see_duel(duel_id));
create policy "change own duel reaction" on duel_reactions for update using (user_id = auth.uid());
create policy "remove own duel reaction" on duel_reactions for delete using (user_id = auth.uid());

create policy "posts readable" on posts for select using (true);
create policy "create post" on posts for insert with check (author_id = auth.uid());
create policy "delete own post" on posts for delete using (author_id = auth.uid());
create policy "predictions readable" on predictions for select using (true);
create policy "create prediction" on predictions for insert with check (user_id = auth.uid() and correct is null);
create policy "post comments readable" on post_comments for select using (true);
create policy "comment on post" on post_comments for insert with check (author_id = auth.uid());
create policy "delete own post comment" on post_comments for delete using (author_id = auth.uid());
create policy "post reactions readable" on post_reactions for select using (true);
create policy "react to post" on post_reactions for insert with check (user_id = auth.uid());
create policy "change own post reaction" on post_reactions for update using (user_id = auth.uid());
create policy "remove own post reaction" on post_reactions for delete using (user_id = auth.uid());

create policy "follows readable" on follows for select using (true);
create policy "follow" on follows for insert with check (follower_id = auth.uid());
create policy "unfollow" on follows for delete using (follower_id = auth.uid());

create policy "own notifications" on notifications for select using (user_id = auth.uid());
create policy "mark own read" on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "picks readable" on daily_picks for select using (true);
create policy "pick before open" on daily_picks for insert with check (
  user_id = auth.uid() and now() < (session::timestamp + time '09:30') at time zone 'America/New_York'
);

-- rpc grants
revoke all on function accept_duel(uuid) from public;
revoke all on function decline_duel(uuid) from public;
revoke all on function cancel_duel(uuid) from public;
grant execute on function accept_duel(uuid) to authenticated;
grant execute on function decline_duel(uuid) to authenticated;
grant execute on function cancel_duel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- storage: avatars bucket (public read, owner write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
create policy "avatar read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatar write own" on storage.objects for insert with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
create policy "avatar update own" on storage.objects for update using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

-- realtime for live duel pages and inboxes
alter publication supabase_realtime add table duels, duel_comments, duel_reactions, notifications, post_comments, post_reactions;

-- ===== supabase/migrations/20261126000000_social_triggers.sql =====
-- cross-user notifications are created by the database, because a browser can only
-- write its own rows. all functions are security definer and only insert into
-- notifications.

create or replace function notify(p_user uuid, p_actor uuid, p_kind text, p_text text, p_href text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, actor_id, kind, text, href)
  select p_user, p_actor, p_kind, p_text, p_href
  where p_user is not null and p_user is distinct from p_actor;
$$;

-- invitations
create or replace function on_participant_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare d duels%rowtype; vs text;
begin
  select * into d from duels where id = new.duel_id;
  if new.accepted or new.user_id is null or new.user_id = d.created_by then return new; end if;
  select string_agg(lower(ticker), ' vs ') into vs from duel_participants where duel_id = new.duel_id;
  perform notify(new.user_id, d.created_by, 'duel_invite',
    'challenged you: ' || coalesce(vs, lower(new.ticker)) || ', $' || trim(to_char(d.stake, 'FM999990.##')) || ' each, ' || d.deadline_label,
    '/duel/' || d.id);
  return new;
end $$;
create trigger participants_notify_insert after insert on duel_participants for each row execute function on_participant_insert();

-- acceptances
create or replace function on_participant_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare d duels%rowtype;
begin
  if old.accepted or not new.accepted then return new; end if;
  select * into d from duels where id = new.duel_id;
  perform notify(d.created_by, new.user_id, 'duel_accepted', 'accepted your challenge. prices lock at the next market close.', '/duel/' || d.id);
  return new;
end $$;
create trigger participants_notify_accept after update on duel_participants for each row execute function on_participant_accept();

-- declines and activation
create or replace function on_duel_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.status = old.status then return new; end if;
  if new.status = 'declined' then
    for p in select user_id from duel_participants where duel_id = new.id and not accepted and user_id is not null loop
      perform notify(new.created_by, p.user_id, 'duel_declined', 'declined your challenge.', '/duel/' || new.id);
    end loop;
  elsif new.status = 'active' then
    for p in select user_id from duel_participants where duel_id = new.id and user_id is not null loop
      perform notify(p.user_id, null, 'duel_active', 'your duel is live. starting prices are locked.', '/duel/' || new.id);
    end loop;
  end if;
  return new;
end $$;
create trigger duels_notify_status after update of status on duels for each row execute function on_duel_status();

-- follows
create or replace function on_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(new.followee_id, new.follower_id, 'follow', 'started following you', '/u/' || (select username from profiles where id = new.follower_id));
  return new;
end $$;
create trigger follows_notify after insert on follows for each row execute function on_follow();

-- comments
create or replace function on_post_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify((select author_id from posts where id = new.post_id), new.author_id, 'comment',
    'commented: “' || left(new.body, 80) || '”', '/post/' || new.post_id);
  return new;
end $$;
create trigger post_comments_notify after insert on post_comments for each row execute function on_post_comment();

create or replace function on_duel_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select user_id from duel_participants where duel_id = new.duel_id and user_id is not null loop
    perform notify(p.user_id, new.author_id, 'comment', 'commented on your duel: “' || left(new.body, 80) || '”', '/duel/' || new.duel_id);
  end loop;
  return new;
end $$;
create trigger duel_comments_notify after insert on duel_comments for each row execute function on_duel_comment();

-- reactions
create or replace function on_post_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify((select author_id from posts where id = new.post_id), new.user_id, 'reaction', 'reacted to your post', '/post/' || new.post_id);
  return new;
end $$;
create trigger post_reactions_notify after insert on post_reactions for each row execute function on_post_reaction();

-- beef of the day: any signed-in user may create today's or a future matchup (the
-- primary key stops anyone overwriting an existing one)
create policy "create daily matchup" on daily_beefs for insert to authenticated
  with check (session >= (now() at time zone 'America/New_York')::date and ticker_a <> ticker_b);

-- onboarding fields can't be used to fake an accepted duel: is_adult is checked by
-- accept_duel, and only the owner can set it on their own profile (existing policy).

-- realtime for the rest of the social tables
alter publication supabase_realtime add table posts, follows, duel_participants, community_members, daily_picks;

-- ===== supabase/migrations/20261127000000_wallets.sql =====
-- embedded wallets (cdp) on base sepolia.
-- one beef user ↔ one cdp end user ↔ one smart account. rows are written only by the
-- server (service role) after it verifies the cdp access token; users can read their own.

create table wallet_links (
  user_id uuid primary key references profiles(id) on delete cascade,
  cdp_user_id text not null unique,
  eoa_address text unique check (eoa_address is null or eoa_address ~ '^0x[0-9a-f]{40}$'),
  smart_account_address text not null unique check (smart_account_address ~ '^0x[0-9a-f]{40}$'),
  auth_methods text[] not null default '{}',
  chain_id int not null default 84532 check (chain_id = 84532), -- base sepolia only
  linked_at timestamptz not null default now()
);

create type wallet_intent_action as enum ('create', 'accept', 'refund', 'settle');
create type wallet_intent_status as enum ('prepared', 'sponsored', 'submitted', 'confirmed', 'failed');

-- server-built transactions. the paymaster proxy only sponsors user operations whose
-- calls hash to an intent here.
create table wallet_intents (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  smart_account_address text not null,
  action wallet_intent_action not null,
  duel_id uuid not null references duels(id) on delete cascade,
  amount_units numeric(20,0) not null default 0 check (amount_units >= 0 and amount_units <= 25000000),
  calls_hash text not null,
  calls jsonb not null,
  status wallet_intent_status not null default 'prepared',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sponsored_at timestamptz,
  user_op_hash text,
  tx_hash text unique,
  error text
);
create index wallet_intents_user_idx on wallet_intents(user_id, created_at desc);
create index wallet_intents_sponsored_idx on wallet_intents(sponsored_at) where sponsored_at is not null;
create index wallet_intents_sender_idx on wallet_intents(smart_account_address, sponsored_at);
-- at most one live or confirmed intent per user, duel and action (no duplicate submissions)
create unique index wallet_intents_one_confirmed on wallet_intents(user_id, duel_id, action) where status = 'confirmed';

-- every sponsorship decision (allowed / refused / upstream error), for monitoring
create table sponsorship_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  intent_id uuid,
  sender text,
  method text not null,
  decision text not null check (decision in ('allowed', 'refused', 'error')),
  reason text not null
);
create index sponsorship_logs_at_idx on sponsorship_logs(at desc);

create trigger sponsorship_logs_append_only before update or delete on sponsorship_logs for each row execute function forbid_change();

alter table wallet_links enable row level security;
alter table wallet_intents enable row level security;
alter table sponsorship_logs enable row level security;

-- read-only for the owner. no insert/update/delete policies: only the service role writes.
create policy "own wallet link" on wallet_links for select using (user_id = auth.uid());
create policy "own wallet intents" on wallet_intents for select using (user_id = auth.uid());
-- sponsorship_logs: no client access at all

-- public smart-account addresses so people can see who has a wallet (no secrets here)
create or replace view wallet_addresses with (security_invoker = false) as
  select user_id, smart_account_address from wallet_links;
grant select on wallet_addresses to anon, authenticated;

-- ===== supabase/migrations/20261128000000_real_users.sql =====
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

-- ===== supabase/seed.sql =====
-- generated by scripts/generate-seed-sql.ts. reference data only: no users or activity.
insert into stock_assets (ticker, name, sector, tokenized) values
  ('NVDA', 'NVIDIA', 'semiconductors', true),
  ('AAPL', 'Apple', 'tech', true),
  ('TSLA', 'Tesla', 'autos', true),
  ('MSFT', 'Microsoft', 'tech', true),
  ('AMZN', 'Amazon', 'consumer', true),
  ('GOOGL', 'Alphabet', 'tech', true),
  ('META', 'Meta Platforms', 'tech', true),
  ('AMD', 'Advanced Micro Devices', 'semiconductors', false),
  ('AVGO', 'Broadcom', 'semiconductors', false),
  ('TSM', 'Taiwan Semiconductor', 'semiconductors', false),
  ('NFLX', 'Netflix', 'media', false),
  ('PLTR', 'Palantir', 'software', false),
  ('COIN', 'Coinbase', 'fintech', false),
  ('GME', 'GameStop', 'retail', false),
  ('AMC', 'AMC Entertainment', 'media', false),
  ('JPM', 'JPMorgan Chase', 'banks', false),
  ('KO', 'Coca-Cola', 'staples', false),
  ('COST', 'Costco', 'retail', false),
  ('DIS', 'Disney', 'media', false),
  ('SMCI', 'Super Micro Computer', 'semiconductors', false)
on conflict (ticker) do update set name = excluded.name, sector = excluded.sector;

insert into achievements (id, name, description, emoji) values
  ('first_duel', 'first beef', 'complete your first duel', '🥩'),
  ('five_wins', 'high five', 'win five duels', '🖐️'),
  ('ten_duels', 'regular', 'complete ten duels', '🔟'),
  ('streak_3', 'heating up', 'win three in a row', '🔥'),
  ('streak_5', 'on a heater', 'win five in a row', '☄️'),
  ('oracle', 'called it', 'get three daily beef picks right', '🔮'),
  ('voice', 'loud and clear', 'publish five opinions', '📣'),
  ('community', 'joiner', 'join three communities', '🤝'),
  ('commenter', 'in the replies', 'leave ten comments', '💬')
on conflict (id) do update set name = excluded.name, description = excluded.description, emoji = excluded.emoji;
