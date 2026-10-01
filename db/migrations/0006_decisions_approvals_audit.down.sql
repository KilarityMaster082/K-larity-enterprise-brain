-- Owner task: EB-53 · EB-66 · EB-24
-- audit_log is deliberately NOT dropped by a routine down-migration: dropping it destroys the audit trail.
-- Run `DROP TABLE audit_log` by hand, as the schema owner, only when decommissioning a tenant database.
DROP TABLE IF EXISTS approvals;
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_decided_fields;
ALTER TABLE decisions
    DROP COLUMN IF EXISTS alternatives, DROP COLUMN IF EXISTS evidence_ids, DROP COLUMN IF EXISTS cost_impact,
    DROP COLUMN IF EXISTS time_impact_days, DROP COLUMN IF EXISTS confidence, DROP COLUMN IF EXISTS reviewed_by,
    DROP COLUMN IF EXISTS review_note, DROP COLUMN IF EXISTS version;
