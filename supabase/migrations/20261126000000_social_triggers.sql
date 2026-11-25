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
