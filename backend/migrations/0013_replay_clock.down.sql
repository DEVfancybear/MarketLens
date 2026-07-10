DROP TABLE IF EXISTS replay_checkpoints;
DROP TABLE IF EXISTS replay_events;
DROP TABLE IF EXISTS replay_commands;
DROP TYPE IF EXISTS replay_command_status;

ALTER TABLE replay_sessions
  DROP CONSTRAINT IF EXISTS replay_sessions_actor_lease_pair,
  DROP COLUMN IF EXISTS actor_lease_until,
  DROP COLUMN IF EXISTS actor_owner;

-- PostgreSQL enum values cannot be removed safely in-place. The harmless
-- playing/completed labels remain after rollback; Phase 1 never writes them.
