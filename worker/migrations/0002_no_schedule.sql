-- Reminders get no schedule (shared/CONTRACT.md): reminder settings keep only embed_in_my_reminders, deliveries
-- lose earliest_at and repeat, and recommendations.kind takes only mistake and word. Rows are kept.

UPDATE users SET reminder_settings = CASE
  WHEN json_extract(reminder_settings, '$.embed_in_my_reminders') THEN '{"embed_in_my_reminders":true}'
  ELSE '{"embed_in_my_reminders":false}'
END;

CREATE TABLE recommendations_old AS SELECT * FROM recommendations;
CREATE TABLE deliveries_old AS SELECT id, user_id, recommendation_id, marker, status, outcome, claimed_by, claimed_until, failures, error_code, created_at, updated_at FROM deliveries;
DROP TABLE deliveries;
DROP TABLE recommendations;

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transcript_id TEXT REFERENCES transcripts (id) ON DELETE SET NULL,
  language TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mistake', 'word')),
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX deliveries_user_status ON deliveries (user_id, status);
CREATE INDEX deliveries_marker ON deliveries (marker);
CREATE INDEX deliveries_recommendation ON deliveries (recommendation_id);

INSERT INTO recommendations (id, user_id, transcript_id, language, kind, item_key, marker, rank, title, notes, embed_line,
  match_terms, priority, content, created_at)
SELECT id, user_id, transcript_id, language, kind, item_key, marker, rank, title, notes, embed_line,
  match_terms, priority, content, created_at
FROM recommendations_old;
INSERT INTO deliveries (id, user_id, recommendation_id, marker, status, outcome, claimed_by, claimed_until, failures, error_code, created_at, updated_at)
SELECT id, user_id, recommendation_id, marker, status, outcome, claimed_by, claimed_until, failures, error_code, created_at, updated_at FROM deliveries_old;
DROP TABLE recommendations_old;
DROP TABLE deliveries_old;
