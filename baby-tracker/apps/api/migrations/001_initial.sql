CREATE TABLE profiles (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  birth_date date,
  sex text NOT NULL CHECK (sex IN ('male','female')),
  timezone text NOT NULL,
  daily_goal_oz numeric(6,2) NOT NULL CHECK (daily_goal_oz > 0 AND daily_goal_oz <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE goal_history (
  profile_id text NOT NULL REFERENCES profiles(id),
  effective_date date NOT NULL,
  goal_oz numeric(6,2) NOT NULL CHECK (goal_oz > 0 AND goal_oz <= 100),
  PRIMARY KEY (profile_id, effective_date)
);
CREATE TABLE days (
  profile_id text NOT NULL REFERENCES profiles(id),
  date date NOT NULL,
  goal_oz numeric(6,2) NOT NULL CHECK (goal_oz > 0 AND goal_oz <= 100),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (profile_id, date)
);
CREATE TABLE day_events (
  id uuid PRIMARY KEY,
  profile_id text NOT NULL,
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('feed','sleep','note')),
  time time NOT NULL,
  end_time time,
  amount_oz numeric(6,2),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status text NOT NULL CHECK (status IN ('completed','planned')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profile_id,date) REFERENCES days(profile_id,date),
  CHECK ((type = 'feed' AND amount_oz > 0 AND amount_oz <= 32) OR (type <> 'feed' AND amount_oz IS NULL)),
  CHECK (type = 'sleep' OR end_time IS NULL),
  CHECK (end_time IS NULL OR end_time <> time),
  CHECK (type <> 'note' OR length(note) > 0)
);
CREATE INDEX day_events_day ON day_events(profile_id,date,time);
CREATE TABLE measurements (
  id uuid PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id),
  date date NOT NULL,
  weight_kg numeric(7,3) CHECK (weight_kg > 0 AND weight_kg <= 100),
  length_cm numeric(6,2) CHECK (length_cm > 0 AND length_cm <= 200),
  head_cm numeric(6,2) CHECK (head_cm > 0 AND head_cm <= 100),
  source text NOT NULL DEFAULT '' CHECK(length(source) <= 200),
  note text NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  needs_review boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (weight_kg IS NOT NULL OR length_cm IS NOT NULL OR head_cm IS NOT NULL)
);
CREATE INDEX measurements_profile_date ON measurements(profile_id,date);
CREATE TABLE mutation_receipts (
  profile_id text NOT NULL REFERENCES profiles(id),
  request_id uuid NOT NULL,
  actor_id text NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id,request_id)
);
INSERT INTO profiles(id,name,birth_date,sex,timezone,daily_goal_oz) VALUES('beckett','Beckett',NULL,'male','America/New_York',28);
INSERT INTO goal_history(profile_id,effective_date,goal_oz) VALUES('beckett','0001-01-01',28);
