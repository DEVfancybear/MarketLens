ALTER TYPE replay_session_status ADD VALUE IF NOT EXISTS 'playing' BEFORE 'closed';
ALTER TYPE replay_session_status ADD VALUE IF NOT EXISTS 'completed' BEFORE 'closed';

ALTER TABLE replay_sessions
  ADD COLUMN actor_owner text,
  ADD COLUMN actor_lease_until timestamptz,
  ADD CONSTRAINT replay_sessions_actor_lease_pair CHECK (
    (actor_owner IS NULL AND actor_lease_until IS NULL) OR
    (actor_owner IS NOT NULL AND actor_lease_until IS NOT NULL)
  );
CREATE INDEX idx_replay_sessions_actor_lease
  ON replay_sessions(actor_lease_until) WHERE actor_owner IS NOT NULL;

CREATE TYPE replay_command_status AS ENUM ('accepted', 'applied', 'rejected', 'failed');

CREATE TABLE replay_commands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  command_seq      bigint NOT NULL CHECK (command_seq > 0),
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  expected_version bigint,
  command_type     text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           replay_command_status NOT NULL DEFAULT 'accepted',
  result           jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  UNIQUE (session_id, command_seq),
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX idx_replay_commands_pending
  ON replay_commands(session_id, command_seq) WHERE status = 'accepted';

CREATE TABLE replay_events (
  session_id   uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  event_seq    bigint NOT NULL CHECK (event_seq > 0),
  version      bigint NOT NULL CHECK (version >= 0),
  event_type   text NOT NULL,
  simulated_at timestamptz NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_seq)
);
CREATE INDEX idx_replay_events_resume ON replay_events(session_id, event_seq);

CREATE TABLE replay_checkpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  generation      integer NOT NULL CHECK (generation > 0),
  event_seq       bigint NOT NULL CHECK (event_seq >= 0),
  simulated_time  timestamptz NOT NULL,
  snapshot        jsonb NOT NULL,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, generation, event_seq)
);
CREATE INDEX idx_replay_checkpoints_latest
  ON replay_checkpoints(session_id, generation, event_seq DESC);
