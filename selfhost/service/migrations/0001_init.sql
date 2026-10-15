-- Accounts are Discord users. A new one waits for the administrator's approval.
CREATE TABLE accounts (
  discord_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- Only the hash of a session token is kept. A session ends 30 days after its last use.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES accounts (discord_id),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

-- A launcher signing in: it polls with its device code while the browser goes through Discord.
CREATE TABLE device_logins (
  code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  state TEXT UNIQUE,
  discord_id TEXT,
  expires_at INTEGER NOT NULL
);

-- The name is the primary key: two GMs asking for one name at once, the database keeps one.
CREATE TABLE campaigns (
  name TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES accounts (discord_id),
  tunnel_id TEXT,
  dns_record_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX campaigns_by_owner ON campaigns (discord_id);
CREATE INDEX sessions_by_owner ON sessions (discord_id);
