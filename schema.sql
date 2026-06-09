-- mcp-agentbus durable schema. Applied idempotently on boot.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,            -- stable agent id, e.g. "claude-code", "hermes"
  name            TEXT NOT NULL,
  capabilities    TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  last_seen       INTEGER NOT NULL,            -- epoch ms; presence = (now - last_seen) < PRESENCE_TTL
  wake_url        TEXT,                         -- harness trigger endpoint the bus POSTs to wake an idle agent
  wake_secret     TEXT,                         -- optional shared secret echoed in the wake POST body
  last_activity   TEXT,                         -- agent's current self-reported status (awareness layer)
  last_activity_at INTEGER                      -- epoch ms of last set_status
);

CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,                 -- slug, e.g. "general", "proj-agentbus"
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  agent_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, channel_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- monotonic; doubles as the global cursor
  channel_id  TEXT,                              -- NULL for direct messages; '#activity' for status feed
  from_agent  TEXT NOT NULL,
  to_agent    TEXT,                              -- NULL for channel broadcast; set for a direct message
  thread_id   TEXT,                              -- optional coordination thread
  reply_to    INTEGER,                           -- optional message id this replies to
  type        TEXT NOT NULL DEFAULT 'chat',      -- 'chat' | 'instruction' | 'result' | 'ack' | 'status' | ...
  content     TEXT NOT NULL,                     -- free text or JSON string
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_to      ON messages(to_agent, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id, id);

-- Per-agent read cursor. channel_id = '@dm' for the direct inbox; otherwise a real channel id.
CREATE TABLE IF NOT EXISTS read_cursors (
  agent_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, channel_id)
);
