-- Soul Inbox schema (SQLite). All timestamps are epoch milliseconds (UTC).

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','manager','supervisor','agent')),
  active          INTEGER NOT NULL DEFAULT 1,
  in_rotation     INTEGER NOT NULL DEFAULT 1,      -- receives auto-assigned chats
  max_open        INTEGER NOT NULL DEFAULT 30,     -- max chats waiting for this agent's reply
  presence        TEXT NOT NULL DEFAULT 'offline' CHECK (presence IN ('online','away','offline')),
  last_seen_at    INTEGER,
  last_assigned_at INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Connected accounts: a Facebook Page (messenger + fb comments), an Instagram
-- professional account (DMs + comments) or a WhatsApp Cloud API phone number.
CREATE TABLE IF NOT EXISTS channels (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('messenger','instagram','whatsapp')),
  name             TEXT NOT NULL,
  external_id      TEXT NOT NULL,   -- page id / instagram account id / whatsapp phone_number_id
  page_id          TEXT,            -- instagram: the linked Facebook page id
  waba_id          TEXT,            -- whatsapp business account id
  access_token_enc TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  UNIQUE (kind, external_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  avatar_url   TEXT,
  notes        TEXT,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- One row per platform identity (PSID / IGSID / WhatsApp number). A customer can own several.
CREATE TABLE IF NOT EXISTS customer_identities (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  channel_id   INTEGER NOT NULL REFERENCES channels(id),
  channel_kind TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  display_name TEXT,
  username     TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_customer ON customer_identities(customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id                   INTEGER PRIMARY KEY,
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  identity_id          INTEGER NOT NULL REFERENCES customer_identities(id),
  channel_id           INTEGER NOT NULL REFERENCES channels(id),
  channel_kind         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'needs_reply'
                       CHECK (status IN ('needs_reply','waiting_customer','snoozed','closed')),
  type                 TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (type IN ('unknown','sales_lead','existing_guest','owner','broker','complaint','supplier','spam','other')),
  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  assigned_user_id     INTEGER REFERENCES users(id),
  assigned_at          INTEGER,
  -- SLA state for the current "customer is waiting" cycle
  awaiting_since       INTEGER,   -- first unanswered inbound message
  sla_start_at         INTEGER,   -- awaiting_since moved to the next business-hours start
  sla_due_at           INTEGER,   -- deadline for the current assignee
  sla_warned           INTEGER NOT NULL DEFAULT 0,
  sla_breached         INTEGER NOT NULL DEFAULT 0,
  escalation_level     INTEGER NOT NULL DEFAULT 0,  -- 1 supervisor, 2 manager
  reassign_count       INTEGER NOT NULL DEFAULT 0,  -- automatic reassignments in this cycle
  last_message_at      INTEGER,
  last_inbound_at      INTEGER,
  last_message_preview TEXT,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  snooze_until         INTEGER,
  current_lead_id      INTEGER,
  source               TEXT,
  ad_id                TEXT,
  ad_ref_json          TEXT,
  ai_json              TEXT,      -- latest AI classification
  ai_summary           TEXT,
  night_ai_replies     INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  closed_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conv_identity ON conversations(identity_id);
CREATE INDEX IF NOT EXISTS idx_conv_assigned ON conversations(assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conv_awaiting ON conversations(awaiting_since);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender_type      TEXT NOT NULL CHECK (sender_type IN ('customer','agent','ai','auto','external')),
  user_id          INTEGER REFERENCES users(id),
  channel_kind     TEXT NOT NULL,
  external_id      TEXT,
  body             TEXT,
  attachments_json TEXT,
  delivery_status  TEXT NOT NULL DEFAULT 'received'
                   CHECK (delivery_status IN ('received','pending','sent','delivered','read','failed')),
  error            TEXT,
  created_at       INTEGER NOT NULL
);
-- Idempotency: the same platform message id can never be stored twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_external ON messages(channel_kind, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notes (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_conv ON notes(conversation_id);

CREATE TABLE IF NOT EXISTS lead_stages (
  key              TEXT PRIMARY KEY,
  name_en          TEXT NOT NULL,
  name_ar          TEXT NOT NULL,
  position         INTEGER NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('open','won','lost','invalid')),
  requires_phone   INTEGER NOT NULL DEFAULT 0,
  requires_follow_up INTEGER NOT NULL DEFAULT 0,
  is_qualified     INTEGER NOT NULL DEFAULT 0,   -- reaching this stage counts as "qualified"
  active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lost_reasons (
  key      TEXT PRIMARY KEY,
  name_en  TEXT NOT NULL,
  name_ar  TEXT NOT NULL,
  position INTEGER NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  conversation_id   INTEGER REFERENCES conversations(id),
  stage_key         TEXT NOT NULL REFERENCES lead_stages(key),
  owner_user_id     INTEGER REFERENCES users(id),
  source            TEXT,
  campaign          TEXT,
  project           TEXT,
  unit_type         TEXT,
  check_in          TEXT,
  check_out         TEXT,
  guests            INTEGER,
  budget            TEXT,
  temperature       TEXT CHECK (temperature IN ('hot','warm','cold') OR temperature IS NULL),
  lost_reason_key   TEXT REFERENCES lost_reasons(key),
  lost_note         TEXT,
  booking_ref       TEXT,
  booking_value     REAL,
  created_by        INTEGER REFERENCES users(id),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  qualified_at      INTEGER,
  won_at            INTEGER,
  closed_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leads_conv ON leads(conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_key, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS lead_stage_history (
  id         INTEGER PRIMARY KEY,
  lead_id    INTEGER NOT NULL REFERENCES leads(id),
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lsh_lead ON lead_stage_history(lead_id, at);

CREATE TABLE IF NOT EXISTS follow_ups (
  id               INTEGER PRIMARY KEY,
  lead_id          INTEGER REFERENCES leads(id),
  conversation_id  INTEGER REFERENCES conversations(id),
  assigned_user_id INTEGER REFERENCES users(id),
  due_at           INTEGER NOT NULL,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  notified         INTEGER NOT NULL DEFAULT 0,
  escalated        INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  done_at          INTEGER,
  done_by          INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON follow_ups(status, due_at);

-- Every human reply to a waiting customer: the raw material for response-time KPIs.
CREATE TABLE IF NOT EXISTS responses (
  id               INTEGER PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  user_id          INTEGER REFERENCES users(id),     -- who replied (NULL = replied outside the system)
  assigned_user_id INTEGER REFERENCES users(id),     -- who owned the chat at that moment
  channel_kind     TEXT NOT NULL,
  awaiting_since   INTEGER NOT NULL,
  sla_start_at     INTEGER NOT NULL,
  responded_at     INTEGER NOT NULL,
  seconds_raw      INTEGER NOT NULL,                 -- wall clock
  seconds_sla      INTEGER NOT NULL,                 -- measured from business-hours start
  within_sla       INTEGER NOT NULL,
  is_first         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_responses_at ON responses(responded_at);

CREATE TABLE IF NOT EXISTS sla_events (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  user_id         INTEGER REFERENCES users(id),       -- assignee at the time
  kind            TEXT NOT NULL CHECK (kind IN ('warning','breach','escalation_supervisor','escalation_manager')),
  at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sla_events_at ON sla_events(at);

CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  from_user_id    INTEGER REFERENCES users(id),
  to_user_id      INTEGER REFERENCES users(id),
  by_user_id      INTEGER REFERENCES users(id),       -- NULL = system
  reason          TEXT NOT NULL,
  at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_conv ON assignments(conversation_id, at);
CREATE INDEX IF NOT EXISTS idx_assignments_at ON assignments(at);

-- Append-only audit log. Triggers below make UPDATE and DELETE impossible.
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER,
  lead_id         INTEGER,
  user_id         INTEGER,
  type            TEXT NOT NULL,
  data_json       TEXT,
  at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_conv ON events(conversation_id, at);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

CREATE TABLE IF NOT EXISTS comments (
  id                 INTEGER PRIMARY KEY,
  channel_id         INTEGER NOT NULL REFERENCES channels(id),
  platform           TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  external_id        TEXT NOT NULL,
  post_id            TEXT,
  post_link          TEXT,
  parent_external_id TEXT,
  author_external_id TEXT,
  author_name        TEXT,
  body               TEXT,
  created_at         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','handled')),
  assigned_user_id   INTEGER REFERENCES users(id),
  public_reply       TEXT,
  public_reply_at    INTEGER,
  public_reply_by    INTEGER REFERENCES users(id),
  private_reply_at   INTEGER,
  private_reply_by   INTEGER REFERENCES users(id),
  customer_id        INTEGER REFERENCES customers(id),
  lead_id            INTEGER REFERENCES leads(id),
  handled_at         INTEGER,
  handled_by         INTEGER REFERENCES users(id),
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  shortcut   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  conversation_id INTEGER,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS webhook_log (
  id          INTEGER PRIMARY KEY,
  object      TEXT,
  received_at INTEGER NOT NULL,
  payload     TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_log_at ON webhook_log(received_at);
