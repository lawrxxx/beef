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
