-- Versioned, data-driven prop-firm catalog. Runtime evaluation selects rule
-- strategies from JSON and never branches on provider or program names.

CREATE TABLE execution_prop_risk_profiles (
  profile_id          text NOT NULL CHECK (
                        profile_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
                      ),
  profile_version     integer NOT NULL CHECK (profile_version > 0),
  provider_code       text NOT NULL CHECK (
                        provider_code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'
                      ),
  program_code        text NOT NULL CHECK (
                        program_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'
                      ),
  display_name        text NOT NULL CHECK (
                        char_length(display_name) BETWEEN 1 AND 120
                      ),
  timezone            text NOT NULL CHECK (
                        char_length(timezone) BETWEEN 1 AND 64
                      ),
  rules_locked        boolean NOT NULL DEFAULT true,
  capital_mode        text NOT NULL CHECK (
                        capital_mode IN ('reference_balances', 'manual')
                      ),
  reference_balances  jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules               jsonb NOT NULL,
  actions             jsonb NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  official_source_url text CHECK (
                        official_source_url IS NULL
                        OR official_source_url ~ '^https://[^[:space:]]+$'
                      ),
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, profile_version),
  CHECK (updated_at >= created_at),
  CHECK (verified_at IS NULL OR official_source_url IS NOT NULL),
  CHECK (
    jsonb_typeof(reference_balances) = 'array'
    AND (
      (
        capital_mode = 'manual'
        AND reference_balances = '[]'::jsonb
      )
      OR (
        capital_mode = 'reference_balances'
        AND jsonb_array_length(reference_balances) > 0
        AND NOT jsonb_path_exists(
          reference_balances,
          '$[*] ? (@.type() != "number" || @ <= 0)'
        )
      )
    )
  ),
  CHECK (
    jsonb_typeof(rules) = 'object'
    AND rules ?& ARRAY[
      'dailyLossLimitBasisPoints',
      'maxLossLimitBasisPoints',
      'maxRiskPerTradeBasisPoints',
      'maxTotalOpenRiskBasisPoints',
      'requireStopLoss',
      'warningBufferBasisPoints',
      'emergencyBufferBasisPoints',
      'dailyProfitTargetBasisPoints',
      'dailyLossReference',
      'maxLossMode',
      'profitTargetBasisPoints',
      'bestDayLimitBasisPoints',
      'minimumTradingDays'
    ]
    AND jsonb_path_match(
      rules,
      '$.dailyLossLimitBasisPoints.type() == "number"
        && $.dailyLossLimitBasisPoints > 0
        && $.dailyLossLimitBasisPoints <= 10000
        && $.maxLossLimitBasisPoints.type() == "number"
        && $.maxLossLimitBasisPoints > 0
        && $.maxLossLimitBasisPoints <= 10000
        && $.maxRiskPerTradeBasisPoints.type() == "number"
        && $.maxRiskPerTradeBasisPoints > 0
        && $.maxRiskPerTradeBasisPoints <= 10000
        && $.maxTotalOpenRiskBasisPoints.type() == "number"
        && $.maxTotalOpenRiskBasisPoints > 0
        && $.maxTotalOpenRiskBasisPoints <= 10000
        && $.maxRiskPerTradeBasisPoints <= $.maxTotalOpenRiskBasisPoints
        && $.requireStopLoss.type() == "boolean"
        && $.warningBufferBasisPoints.type() == "number"
        && $.warningBufferBasisPoints >= 0
        && $.warningBufferBasisPoints < $.dailyLossLimitBasisPoints
        && $.emergencyBufferBasisPoints.type() == "number"
        && $.emergencyBufferBasisPoints >= 0
        && $.emergencyBufferBasisPoints <= $.warningBufferBasisPoints'
    )
    AND rules->>'dailyLossReference' IN (
      'startOfDayBalance',
      'initialBalance'
    )
    AND rules->>'maxLossMode' IN ('static', 'endOfDayTrailing')
    AND (
      rules->'dailyProfitTargetBasisPoints' = 'null'::jsonb
      OR jsonb_path_match(
        rules,
        '$.dailyProfitTargetBasisPoints.type() == "number"
          && $.dailyProfitTargetBasisPoints > 0
          && $.dailyProfitTargetBasisPoints <= 10000'
      )
    )
    AND (
      rules->'profitTargetBasisPoints' = 'null'::jsonb
      OR jsonb_path_match(
        rules,
        '$.profitTargetBasisPoints.type() == "number"
          && $.profitTargetBasisPoints > 0
          && $.profitTargetBasisPoints <= 10000'
      )
    )
    AND (
      rules->'bestDayLimitBasisPoints' = 'null'::jsonb
      OR jsonb_path_match(
        rules,
        '$.bestDayLimitBasisPoints.type() == "number"
          && $.bestDayLimitBasisPoints > 0
          && $.bestDayLimitBasisPoints <= 10000'
      )
    )
    AND (
      rules->'minimumTradingDays' = 'null'::jsonb
      OR jsonb_path_match(
        rules,
        '$.minimumTradingDays.type() == "number"
          && $.minimumTradingDays > 0
          && $.minimumTradingDays <= 365'
      )
    )
  ),
  CHECK (
    jsonb_typeof(actions) = 'object'
    AND actions ?& ARRAY[
      'blockNewOrders',
      'cancelPendingOrders',
      'closeOpenPositions',
      'lockAfterProfitTarget',
      'failClosedOnStaleData'
    ]
    AND jsonb_path_match(
      actions,
      '$.blockNewOrders.type() == "boolean"
        && $.cancelPendingOrders.type() == "boolean"
        && $.closeOpenPositions.type() == "boolean"
        && $.lockAfterProfitTarget.type() == "boolean"
        && $.failClosedOnStaleData.type() == "boolean"'
    )
  )
);

CREATE UNIQUE INDEX execution_prop_risk_profiles_one_active_version_idx
  ON execution_prop_risk_profiles (profile_id)
  WHERE active;

CREATE INDEX execution_prop_risk_profiles_catalog_idx
  ON execution_prop_risk_profiles (
    active DESC,
    sort_order,
    provider_code,
    program_code,
    profile_version DESC
  );

-- Published profile definitions are immutable. Operational catalog fields may
-- retire/reorder a version, but changing its identity, formulas, or provenance
-- requires inserting a new profile_version so assigned accounts stay pinned
-- to the exact definition they selected.
CREATE FUNCTION prevent_execution_prop_risk_profile_definition_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published prop-risk profile versions cannot be deleted';
  END IF;

  IF ROW(
    NEW.profile_id,
    NEW.profile_version,
    NEW.provider_code,
    NEW.program_code,
    NEW.display_name,
    NEW.timezone,
    NEW.rules_locked,
    NEW.capital_mode,
    NEW.reference_balances,
    NEW.rules,
    NEW.actions,
    NEW.official_source_url,
    NEW.verified_at,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.profile_id,
    OLD.profile_version,
    OLD.provider_code,
    OLD.program_code,
    OLD.display_name,
    OLD.timezone,
    OLD.rules_locked,
    OLD.capital_mode,
    OLD.reference_balances,
    OLD.rules,
    OLD.actions,
    OLD.official_source_url,
    OLD.verified_at,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'published prop-risk profile definitions are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_execution_prop_risk_profile_definition_immutable
  BEFORE UPDATE OR DELETE ON execution_prop_risk_profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_execution_prop_risk_profile_definition_mutation();

WITH catalog_defaults AS (
  SELECT
    '[10000, 25000, 50000, 100000, 200000]'::jsonb AS ftmo_balances,
    '{
      "blockNewOrders": true,
      "cancelPendingOrders": true,
      "closeOpenPositions": true,
      "lockAfterProfitTarget": false,
      "failClosedOnStaleData": true
    }'::jsonb AS default_actions,
    'https://ftmo.com/en/trading-objectives/'::text AS ftmo_source,
    '2026-08-10 00:00:00+00'::timestamptz AS ftmo_verified_at
)
INSERT INTO execution_prop_risk_profiles (
  profile_id,
  profile_version,
  provider_code,
  program_code,
  display_name,
  timezone,
  rules_locked,
  capital_mode,
  reference_balances,
  rules,
  actions,
  active,
  sort_order,
  official_source_url,
  verified_at
)
SELECT
  seed.profile_id,
  seed.profile_version,
  seed.provider_code,
  seed.program_code,
  seed.display_name,
  seed.timezone,
  seed.rules_locked,
  seed.capital_mode,
  CASE
    WHEN seed.capital_mode = 'reference_balances' THEN defaults.ftmo_balances
    ELSE '[]'::jsonb
  END,
  seed.rules,
  defaults.default_actions,
  seed.active,
  seed.sort_order,
  CASE WHEN seed.provider_code = 'ftmo' THEN defaults.ftmo_source END,
  CASE WHEN seed.provider_code = 'ftmo' THEN defaults.ftmo_verified_at END
FROM catalog_defaults AS defaults
CROSS JOIN (
  VALUES
    (
      'ftmo_2_step_step_1',
      1,
      'ftmo',
      'two_step_step_1',
      'FTMO 2-Step · Step 1 (legacy)',
      'Europe/Prague',
      true,
      'reference_balances',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": null,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": null
      }'::jsonb,
      false,
      900
    ),
    (
      'ftmo_2_step_step_2',
      1,
      'ftmo',
      'two_step_step_2',
      'FTMO 2-Step · Step 2 (legacy)',
      'Europe/Prague',
      true,
      'reference_balances',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": null,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": null
      }'::jsonb,
      false,
      910
    ),
    (
      'ftmo_1_step_challenge',
      1,
      'ftmo',
      'one_step_challenge',
      'FTMO 1-Step · Challenge',
      'Europe/Prague',
      true,
      'reference_balances',
      '{
        "dailyLossLimitBasisPoints": 300,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "endOfDayTrailing",
        "profitTargetBasisPoints": 1000,
        "bestDayLimitBasisPoints": 5000,
        "minimumTradingDays": null
      }'::jsonb,
      true,
      10
    ),
    (
      'ftmo_1_step_account',
      1,
      'ftmo',
      'one_step_account',
      'FTMO 1-Step · Account',
      'Europe/Prague',
      true,
      'manual',
      '{
        "dailyLossLimitBasisPoints": 300,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "endOfDayTrailing",
        "profitTargetBasisPoints": null,
        "bestDayLimitBasisPoints": 5000,
        "minimumTradingDays": null
      }'::jsonb,
      true,
      20
    ),
    (
      'ftmo_2_step_step_1',
      2,
      'ftmo',
      'two_step_step_1',
      'FTMO 2-Step · Challenge',
      'Europe/Prague',
      true,
      'reference_balances',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": 1000,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": 4
      }'::jsonb,
      true,
      30
    ),
    (
      'ftmo_2_step_step_2',
      2,
      'ftmo',
      'two_step_step_2',
      'FTMO 2-Step · Verification',
      'Europe/Prague',
      true,
      'reference_balances',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": 500,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": 4
      }'::jsonb,
      true,
      40
    ),
    (
      'ftmo_2_step_account',
      1,
      'ftmo',
      'two_step_account',
      'FTMO 2-Step · Account',
      'Europe/Prague',
      true,
      'manual',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": null,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": null
      }'::jsonb,
      true,
      50
    ),
    (
      'custom_prop_firm',
      1,
      'custom',
      'custom',
      'Quỹ tùy chỉnh',
      'UTC',
      false,
      'manual',
      '{
        "dailyLossLimitBasisPoints": 500,
        "maxLossLimitBasisPoints": 1000,
        "maxRiskPerTradeBasisPoints": 100,
        "maxTotalOpenRiskBasisPoints": 300,
        "requireStopLoss": true,
        "warningBufferBasisPoints": 100,
        "emergencyBufferBasisPoints": 50,
        "dailyProfitTargetBasisPoints": null,
        "dailyLossReference": "startOfDayBalance",
        "maxLossMode": "static",
        "profitTargetBasisPoints": null,
        "bestDayLimitBasisPoints": null,
        "minimumTradingDays": null
      }'::jsonb,
      true,
      1000
    )
) AS seed (
  profile_id,
  profile_version,
  provider_code,
  program_code,
  display_name,
  timezone,
  rules_locked,
  capital_mode,
  rules,
  active,
  sort_order
);
