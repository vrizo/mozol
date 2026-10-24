-- Every table of docs/backend/data-model.md. Enum values follow shared/CONTRACT.md.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  native_language TEXT NOT NULL,
  timezone TEXT NOT NULL,
  speaker_names TEXT NOT NULL CHECK (json_valid(speaker_names)),
  reminder_settings TEXT NOT NULL CHECK (json_valid(reminder_settings)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'app')),
  installation_id TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE app_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX app_codes_user ON app_codes (user_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios')),
  bundle_id TEXT NOT NULL,
  apns_token TEXT,
  apns_environment TEXT CHECK (apns_environment IN ('sandbox', 'production')),
  app_version TEXT,
  os_version TEXT,
  timezone TEXT NOT NULL,
  reminders_access TEXT NOT NULL
    CHECK (reminders_access IN ('full', 'write_only', 'denied', 'restricted', 'not_determined')),
  notifications_access TEXT NOT NULL
    CHECK (notifications_access IN ('authorized', 'provisional', 'ephemeral', 'denied', 'not_determined')),
  push_disabled_at TEXT,
  push_disabled_reason TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((apns_token IS NULL) = (apns_environment IS NULL))
);
CREATE INDEX devices_user ON devices (user_id);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('jamie', 'json')),
  label TEXT NOT NULL,
  hook_token TEXT NOT NULL UNIQUE,
  signing_secret TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  last_event_at TEXT,
  last_event_outcome TEXT CHECK (last_event_outcome IN ('accepted', 'duplicate', 'ignored', 'refused')),
  last_event_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX connections_user ON connections (user_id);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES connections (id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('jamie', 'paste', 'json')),
  external_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('call', 'chat', 'text')),
  title TEXT,
  occurred_at TEXT NOT NULL,
  duration_sec INTEGER,
  language TEXT,
  participants TEXT NOT NULL CHECK (json_valid(participants)),
  segments TEXT NOT NULL CHECK (json_valid(segments)),
  learner_speaker_id TEXT,
  learner_word_count INTEGER,
  status TEXT NOT NULL
    CHECK (status IN ('received', 'needs_speaker', 'queued', 'analyzing', 'analyzed', 'skipped', 'failed')),
  skip_reason TEXT CHECK (skip_reason IN ('too_short', 'too_little_speech', 'native_language')),
  error_code TEXT CHECK (error_code IN (
    'analysis_failed', 'analysis_refused', 'analysis_truncated', 'analysis_invalid', 'transcript_too_long', 'internal'
  )),
  run INTEGER NOT NULL DEFAULT 0,
  analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (connection_id, external_id)
);
CREATE INDEX transcripts_user_occurred ON transcripts (user_id, occurred_at);

CREATE TABLE hook_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  received_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'ignored', 'refused')),
  error_code TEXT,
  transcript_id TEXT REFERENCES transcripts (id) ON DELETE SET NULL
);
CREATE INDEX hook_events_connection_received ON hook_events (connection_id, received_at);
CREATE INDEX hook_events_user ON hook_events (user_id);
CREATE INDEX hook_events_transcript ON hook_events (transcript_id);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL UNIQUE REFERENCES transcripts (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  run INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'too_little_speech', 'native_language')),
  language TEXT,
  result TEXT NOT NULL CHECK (json_valid(result)),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  unmatched_quotes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX analyses_user ON analyses (user_id);

CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  key TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('grammar', 'vocabulary', 'phrasing', 'register', 'fluency', 'spelling', 'punctuation')),
  title TEXT NOT NULL,
  match_terms TEXT NOT NULL CHECK (json_valid(match_terms)),
  occurrences_total INTEGER NOT NULL,
  transcripts_count INTEGER NOT NULL,
  sources TEXT NOT NULL CHECK (json_valid(sources)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'learned', 'dismissed')),
  UNIQUE (user_id, language, key)
);

CREATE TABLE words (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  word_key TEXT NOT NULL,
  term TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('word', 'phrasal_verb', 'collocation', 'idiom', 'phrase')),
  translation TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example TEXT NOT NULL,
  example_translation TEXT NOT NULL,
  times_suggested INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'learning', 'known', 'dismissed')),
  UNIQUE (user_id, language, word_key)
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES patterns (id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('grammar', 'vocabulary', 'phrasing', 'register', 'fluency', 'spelling', 'punctuation')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  occurrences INTEGER NOT NULL,
  title TEXT NOT NULL,
  examples TEXT NOT NULL CHECK (json_valid(examples)),
  explanation TEXT NOT NULL,
  tip TEXT,
  match_terms TEXT NOT NULL CHECK (json_valid(match_terms)),
  created_at TEXT NOT NULL
);
CREATE INDEX findings_transcript ON findings (transcript_id);
CREATE INDEX findings_pattern ON findings (pattern_id);
CREATE INDEX findings_user_pattern ON findings (user_id, pattern_id);

CREATE TABLE word_suggestions (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words (id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('misused', 'better_choice', 'overused_alternative', 'missing_word')),
  learner_said TEXT,
  example TEXT NOT NULL,
  example_translation TEXT NOT NULL,
  match_terms TEXT NOT NULL CHECK (json_valid(match_terms)),
  created_at TEXT NOT NULL
);
CREATE INDEX word_suggestions_transcript ON word_suggestions (transcript_id);
CREATE INDEX word_suggestions_word ON word_suggestions (word_id);
CREATE INDEX word_suggestions_user_word ON word_suggestions (user_id, word_id);

CREATE TABLE keywords (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  language TEXT NOT NULL,
  term TEXT NOT NULL,
  term_lang TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('word', 'prefix', 'phrase', 'substring')),
  PRIMARY KEY (transcript_id, item_key, term, term_lang, mode)
);
CREATE INDEX keywords_user_term ON keywords (user_id, term);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transcript_id TEXT REFERENCES transcripts (id) ON DELETE SET NULL,
  language TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mistake', 'word', 'phrase', 'rewrite')),
  item_key TEXT NOT NULL,
  marker TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  embed_line TEXT NOT NULL,
  match_terms TEXT NOT NULL CHECK (json_valid(match_terms)),
  priority INTEGER NOT NULL CHECK (priority IN (1, 5)),
  content TEXT NOT NULL CHECK (json_valid(content)),
  created_at TEXT NOT NULL,
  UNIQUE (transcript_id, item_key)
);
CREATE INDEX recommendations_user_created ON recommendations (user_id, created_at);
-- Reads by transcript_id use the index of the unique key (transcript_id, item_key).

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL REFERENCES recommendations (id) ON DELETE CASCADE,
  marker TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'applied', 'failed', 'superseded')),
  outcome TEXT CHECK (outcome IN ('embed_updated', 'reminder_updated', 'embedded', 'created')),
  claimed_by TEXT,
  claimed_until TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  due_at TEXT,
  repeat TEXT CHECK (json_valid(repeat)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX deliveries_user_status ON deliveries (user_id, status);
CREATE INDEX deliveries_marker ON deliveries (marker);
CREATE INDEX deliveries_recommendation ON deliveries (recommendation_id);

CREATE TABLE push_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  push_type TEXT NOT NULL CHECK (push_type IN ('deliveries', 'test')),
  apns_id TEXT,
  status INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX push_log_user_created ON push_log (user_id, created_at);
CREATE INDEX push_log_device ON push_log (device_id);

CREATE TABLE worker_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL
);
