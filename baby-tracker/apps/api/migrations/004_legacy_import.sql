ALTER TABLE days ADD COLUMN caregiver_note text NOT NULL DEFAULT '' CHECK (length(caregiver_note) <= 2000);
CREATE TABLE legacy_import_receipts (
  profile_id text NOT NULL REFERENCES profiles(id),
  source text NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  target text NOT NULL CHECK (target IN ('development','production')),
  day_count integer NOT NULL,
  event_count integer NOT NULL,
  measurement_count integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id,source)
);
-- No foreign keys to mutable records: later edits/deletes must not erase provenance.
CREATE TABLE legacy_import_records (
  profile_id text NOT NULL,
  source text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('day','event','measurement')),
  legacy_key text NOT NULL,
  record_id text NOT NULL,
  record_hash text NOT NULL CHECK (length(record_hash) = 64),
  PRIMARY KEY(profile_id,source,kind,legacy_key),
  FOREIGN KEY(profile_id,source) REFERENCES legacy_import_receipts(profile_id,source)
);
