CREATE TABLE ai_rate_limits (
  actor_id text NOT NULL,
  bucket timestamptz NOT NULL,
  count integer NOT NULL CHECK(count > 0),
  PRIMARY KEY(actor_id,bucket)
);
