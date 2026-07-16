ALTER TABLE alerts
  ADD COLUMN technical_target jsonb;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_technical_target_object
  CHECK (technical_target IS NULL OR jsonb_typeof(technical_target) = 'object');
