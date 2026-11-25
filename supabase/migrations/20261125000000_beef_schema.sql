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
