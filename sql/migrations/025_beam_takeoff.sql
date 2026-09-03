-- ---------------------------------------------------------------------------
-- Migration 014 — Beam / Attentive AI maintenance takeoff integration (v1).
--
-- Two new tables plus one flag on estimates.
--
-- beam_requests is PROPERTY-scoped, not estimate-scoped. estimate_id records
-- which estimate triggered the order, but the measurement belongs to the
-- property, so an annual HOA re-bid reuses it instead of paying Attentive again.
-- beam_requests.id (not the estimate id) is what goes in the API's
-- downstream_metadata.id and comes back on every callback.
--
-- beam_outputs is IMMUTABLE and stores value/unit EXACTLY as Attentive sent
-- them — no conversion at this layer. Conversion happens on the way into
-- estimate_sections / estimates so the raw figure stays auditable against Beam.
-- Attentive's outputs are mutable after delivery (an output_edit callback fires
-- whenever anyone edits a shape), so the unique key includes output_updated_at:
-- a redelivery APPENDS a version rather than overwriting the prior one, which is
-- what preserves the Beam-vs-estimator delta.
--
-- property_id / estimate_id are logical refs without FKs, matching the
-- estimates.property_id convention.
--
-- Applied by scripts/migrate.py — do not run by hand.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS beam_requests (
    id                    VARCHAR(36)  NOT NULL,           -- our id; sent as downstream_metadata.id
    property_id           VARCHAR(36)  NOT NULL,
    estimate_id           VARCHAR(36)  DEFAULT NULL,       -- the estimate that triggered the order
    attentive_request_id  VARCHAR(64)  DEFAULT NULL,       -- assigned by Attentive on draft create
    -- Mirrors Attentive's integer status enum (1 Draft … 7 Resubmitted) as a
    -- readable value; 'unordered' is our own pre-create state.
    status                ENUM('unordered','draft','in_progress','completed','failed',
                               'queued','investigating','resubmitted')
                          NOT NULL DEFAULT 'unordered',
    cost_cents            INT          DEFAULT NULL,       -- shown to the estimator BEFORE generate
    eta_seconds           INT          DEFAULT NULL,
    report_type           VARCHAR(64)  DEFAULT NULL,
    parcel_area_sqft      DECIMAL(14,2) DEFAULT NULL,
    address               VARCHAR(512) DEFAULT NULL,
    -- Set the instant the billable generate call is made. Non-NULL is the
    -- idempotency guard: a retry or double-submit must not order twice.
    submitted_at          DATETIME     DEFAULT NULL,
    submitted_by_user_id  VARCHAR(36)  DEFAULT NULL,       -- who spent the money
    completed_at          DATETIME     DEFAULT NULL,
    beam_sync_status      ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    beam_sync_error       TEXT         DEFAULT NULL,
    beam_synced_at        DATETIME     DEFAULT NULL,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_beam_attentive_request (attentive_request_id),
    INDEX idx_beam_req_property    (property_id),
    INDEX idx_beam_req_estimate    (estimate_id),
    INDEX idx_beam_req_sync_status (beam_sync_status),
    INDEX idx_beam_req_status      (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS beam_outputs (
    id                    VARCHAR(36)  NOT NULL,
    beam_request_id       VARCHAR(36)  NOT NULL,
    attentive_output_id   VARCHAR(64)  NOT NULL,
    feature_name          VARCHAR(128) NOT NULL,           -- 'Lawn', 'Hard Edge', 'Driveway'…
    feature_uuid          VARCHAR(64)  DEFAULT NULL,
    geometry_type         TINYINT      DEFAULT NULL,       -- 1 point, 2 line, 3 polygon
    is_custom             TINYINT(1)   NOT NULL DEFAULT 0,
    measurement_name      VARCHAR(32)  NOT NULL,           -- 'area' | 'perimeter' | 'length' | count
    -- Verbatim from Attentive. Never converted here.
    value                 DECIMAL(18,4) DEFAULT NULL,
    unit                  VARCHAR(32)  DEFAULT NULL,       -- 'sq ft' | 'ft' | …
    output_updated_at     DATETIME     DEFAULT NULL,
    -- Stored undecoded so no takeoff is ever re-paid for when map rendering
    -- lands. Decompression is out of scope for v1.
    output_geojson        LONGBLOB     DEFAULT NULL,
    -- What we actually wrote downstream, after unit conversion. Serves two
    -- purposes: it audits the conversion against the raw value above, and it is
    -- how a later delivery tells an untouched section from an estimator-edited
    -- one — if the section no longer holds applied_value, a human changed it.
    applied_to_section_id VARCHAR(36)  DEFAULT NULL,
    applied_value         DECIMAL(18,4) DEFAULT NULL,
    applied_unit          VARCHAR(32)  DEFAULT NULL,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_beam_output_version (attentive_output_id, measurement_name, output_updated_at),
    INDEX idx_beam_out_request (beam_request_id),
    INDEX idx_beam_out_feature (feature_name),
    INDEX idx_beam_out_section (applied_to_section_id),
    CONSTRAINT fk_beam_outputs_request
        FOREIGN KEY (beam_request_id) REFERENCES beam_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Set when an output_edit lands after the estimate has been priced. The
-- measurements are NOT auto-applied at that point — the estimator accepts the
-- diff explicitly, so this flag is what surfaces the stale price.
ALTER TABLE estimates
    ADD COLUMN takeoff_changed_at DATETIME DEFAULT NULL AFTER curb_miles;
