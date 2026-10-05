-- 077 — estimate_assignments audit table (Handoff 54 §6)
--
-- Append-only log of every estimator-slot change. Never UPDATE or DELETE rows.
-- No FK constraints (Cloud SQL migration user limitations).

CREATE TABLE IF NOT EXISTS crm.estimate_assignments (
    id            VARCHAR(36)  NOT NULL,
    estimate_id   VARCHAR(36)  NOT NULL,
    from_user_id  VARCHAR(36)  NULL,          -- NULL on first assignment (no prior assignee)
    to_user_id    VARCHAR(36)  NOT NULL,
    role          ENUM('ls', 'irr') NOT NULL, -- which estimator slot changed
    assigned_by   VARCHAR(36)  NOT NULL,      -- manager who made the assignment
    note          TEXT         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_estimate_assignments_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
