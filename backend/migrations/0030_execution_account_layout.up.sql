CREATE TABLE execution_account_layouts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    item_ids text[] NOT NULL DEFAULT '{}',
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_account_layout_item_limit
        CHECK (cardinality(item_ids) <= 129)
);

COMMENT ON TABLE execution_account_layouts IS
    'Per-user ordering of broker execution accounts and the synthetic simulator rail item.';
