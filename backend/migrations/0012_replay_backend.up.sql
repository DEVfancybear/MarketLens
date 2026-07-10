CREATE TYPE replay_session_status AS ENUM ('preparing', 'paused', 'closed', 'failed');
CREATE TYPE replay_session_mode AS ENUM ('single_chart', 'all_charts');
CREATE TYPE replay_dataset_status AS ENUM ('loading', 'ready', 'failed');
CREATE TYPE replay_data_kind AS ENUM ('bars', 'ticks');

CREATE TABLE replay_datasets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,
  symbol                text NOT NULL,
  data_kind             replay_data_kind NOT NULL DEFAULT 'bars',
  source_timeframe      text NOT NULL,
  base_interval_seconds integer NOT NULL CHECK (base_interval_seconds > 0),
  first_time            timestamptz,
  last_time             timestamptz,
  snapshot_at           timestamptz NOT NULL DEFAULT now(),
  row_count             integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  checksum_sha256       text,
  status                replay_dataset_status NOT NULL DEFAULT 'loading',
  source_meta           jsonb NOT NULL DEFAULT '{}',
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  ready_at              timestamptz,
  CHECK (
    (first_time IS NULL AND last_time IS NULL) OR
    (first_time IS NOT NULL AND last_time IS NOT NULL AND first_time <= last_time)
  ),
  CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    status <> 'ready' OR
    (first_time IS NOT NULL AND last_time IS NOT NULL AND row_count > 0 AND
     checksum_sha256 IS NOT NULL AND ready_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_replay_datasets_ready_checksum
  ON replay_datasets(checksum_sha256) WHERE status = 'ready';
CREATE INDEX idx_replay_datasets_lookup
  ON replay_datasets(provider, symbol, source_timeframe, status, snapshot_at DESC);

CREATE TABLE replay_dataset_bars (
  dataset_id       uuid NOT NULL REFERENCES replay_datasets(id) ON DELETE CASCADE,
  seq              bigint NOT NULL CHECK (seq >= 0),
  open_time        timestamptz NOT NULL,
  interval_seconds integer NOT NULL CHECK (interval_seconds > 0),
  open             numeric(24,10) NOT NULL,
  high             numeric(24,10) NOT NULL,
  low              numeric(24,10) NOT NULL,
  close            numeric(24,10) NOT NULL,
  volume           numeric(28,10) NOT NULL CHECK (volume >= 0),
  complete         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (dataset_id, seq),
  UNIQUE (dataset_id, open_time),
  CHECK (high >= open AND high >= close AND high >= low),
  CHECK (low <= open AND low <= close)
);

CREATE TABLE replay_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                  replay_session_status NOT NULL DEFAULT 'preparing',
  mode                    replay_session_mode NOT NULL DEFAULT 'single_chart',
  generation              integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  version                 bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  next_event_seq          bigint NOT NULL DEFAULT 1 CHECK (next_event_seq > 0),
  speed                   numeric(12,4) NOT NULL DEFAULT 1 CHECK (speed > 0),
  replay_interval_seconds integer NOT NULL CHECK (replay_interval_seconds > 0),
  start_time              timestamptz NOT NULL,
  simulated_time          timestamptz NOT NULL,
  end_time                timestamptz,
  pause_reason            text,
  config                  jsonb NOT NULL DEFAULT '{}',
  last_error              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  CHECK (end_time IS NULL OR start_time <= end_time)
);
CREATE INDEX idx_replay_sessions_user_updated
  ON replay_sessions(user_id, updated_at DESC);
CREATE INDEX idx_replay_sessions_cleanup
  ON replay_sessions(status, COALESCE(closed_at, updated_at));

CREATE TABLE replay_tracks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  dataset_id      uuid NOT NULL REFERENCES replay_datasets(id) ON DELETE RESTRICT,
  slot            smallint NOT NULL CHECK (slot >= 0 AND slot < 4),
  symbol          text NOT NULL,
  provider        text NOT NULL,
  chart_timeframe text NOT NULL,
  cursor_seq      bigint NOT NULL CHECK (cursor_seq >= 0),
  visible_through timestamptz NOT NULL,
  aggregate_state jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot)
);
CREATE INDEX idx_replay_tracks_dataset ON replay_tracks(dataset_id);

CREATE TRIGGER trg_replay_datasets_set_updated_at BEFORE UPDATE ON replay_datasets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_replay_sessions_set_updated_at BEFORE UPDATE ON replay_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_replay_tracks_set_updated_at BEFORE UPDATE ON replay_tracks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
