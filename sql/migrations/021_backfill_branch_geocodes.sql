-- ---------------------------------------------------------------------------
-- Migration 021 — backfill branch geocodes.
--
-- Populates lat/lng for 31 crm.branches rows that were NULL. Coordinates were
-- geocoded from each branch's address1/city/state/zip and are embedded here as
-- LITERAL values — this migration makes NO network calls.
--
-- Source: US Census geocoder (primary), Nominatim/OpenStreetMap (fallback).
--         Census=31 rows, Nominatim=0 rows.
-- Generated: 2026-09-02.
--
-- Each UPDATE is guarded with `AND lat IS NULL` so a re-run — or a reseed that
-- re-nulls nothing — cannot clobber a value later corrected by hand.
--
-- EXCLUDED (still need manual lat/lng entry): 9 rows with no usable or
-- un-geocodable address —
--   1402 Venice Install, 3682 Panama City Beach Maintenance,
--   3685 Tyndall Maintenance, 2224 (PICK A BRANCH),
--   3700 Learning & Development, 3701 Contract and Billing,
--   3703 Training Branch, 3709 Training Branch EC, 3708 Do Not Use.
-- ---------------------------------------------------------------------------

-- 1374 Bradenton Install (FL) [Census]
UPDATE branches SET lat = 27.479024, lng = -82.479626 WHERE aspire_branch_id = 1374 AND lat IS NULL;

-- 1401 DO NOT USE - Naples Install (FL) [Census]
UPDATE branches SET lat = 26.064424, lng = -81.712984 WHERE aspire_branch_id = 1401 AND lat IS NULL;

-- 1919 Fort Lauderdale (DO NOT USE) (FL) [Census]
UPDATE branches SET lat = 26.080939, lng = -80.207793 WHERE aspire_branch_id = 1919 AND lat IS NULL;

-- 3663 Tampa South Maintenance (FL) [Census]
UPDATE branches SET lat = 27.714187, lng = -82.308177 WHERE aspire_branch_id = 3663 AND lat IS NULL;

-- 3664 General Holding (FL) [Census]
UPDATE branches SET lat = 26.659189, lng = -81.775884 WHERE aspire_branch_id = 3664 AND lat IS NULL;

-- 3665 East Orlando (ARY) - DO NOT USE (FL) [Census]
UPDATE branches SET lat = 28.551338, lng = -81.178032 WHERE aspire_branch_id = 3665 AND lat IS NULL;

-- 3669 DO NOT USE - Lakeland (CLM) (FL) [Census]
UPDATE branches SET lat = 27.999238, lng = -81.896897 WHERE aspire_branch_id = 3669 AND lat IS NULL;

-- 3670 DO NOT USE - Sod Install Central - CF (FL) [Census]
UPDATE branches SET lat = 28.499787, lng = -81.640732 WHERE aspire_branch_id = 3670 AND lat IS NULL;

-- 3673 Riviera Beach Sports Turf (FL) [Census]
UPDATE branches SET lat = 26.080939, lng = -80.207793 WHERE aspire_branch_id = 3673 AND lat IS NULL;

-- 3675 DO NOT USE - Arbor (FL) [Census]
UPDATE branches SET lat = 26.659189, lng = -81.775884 WHERE aspire_branch_id = 3675 AND lat IS NULL;

-- 3677 Tampa North Install (FL) [Census]
UPDATE branches SET lat = 28.331022, lng = -82.302480 WHERE aspire_branch_id = 3677 AND lat IS NULL;

-- 3678 DO NOT USE- Palm Bay (FL) [Census]
UPDATE branches SET lat = 28.046509, lng = -80.592286 WHERE aspire_branch_id = 3678 AND lat IS NULL;

-- 3679 Houston Maintenance (TX) [Census]
UPDATE branches SET lat = 29.776830, lng = -95.846439 WHERE aspire_branch_id = 3679 AND lat IS NULL;

-- 3680 Houston Install (TX) [Census]
UPDATE branches SET lat = 29.776830, lng = -95.846439 WHERE aspire_branch_id = 3680 AND lat IS NULL;

-- 3681 Tyndall Install (FL) [Census]
UPDATE branches SET lat = 30.139810, lng = -85.591033 WHERE aspire_branch_id = 3681 AND lat IS NULL;

-- 3684 Bradenton Maintenance (FL) [Census]
UPDATE branches SET lat = 27.479024, lng = -82.479626 WHERE aspire_branch_id = 3684 AND lat IS NULL;

-- 3686 Harrisburg Maintenance (PA) [Census]
UPDATE branches SET lat = 40.316429, lng = -76.851857 WHERE aspire_branch_id = 3686 AND lat IS NULL;

-- 3687 Hershey Maintenance (PA) [Census]
UPDATE branches SET lat = 40.293308, lng = -76.651359 WHERE aspire_branch_id = 3687 AND lat IS NULL;

-- 3688 Raleigh Maintenance (NC) [Census]
UPDATE branches SET lat = 35.721781, lng = -78.662885 WHERE aspire_branch_id = 3688 AND lat IS NULL;

-- 3689 Raleigh Install (NC) [Census]
UPDATE branches SET lat = 35.717374, lng = -78.664264 WHERE aspire_branch_id = 3689 AND lat IS NULL;

-- 3690 Golden Palms on Orange River (FL) [Census]
UPDATE branches SET lat = 26.677436, lng = -81.763481 WHERE aspire_branch_id = 3690 AND lat IS NULL;

-- 3691 Tampa East Maintenance (FL) [Census]
UPDATE branches SET lat = 28.017489, lng = -82.238490 WHERE aspire_branch_id = 3691 AND lat IS NULL;

-- 3692 DO NOT USE- Sarasota Maintenance (FL) [Census]
UPDATE branches SET lat = 27.406307, lng = -82.548733 WHERE aspire_branch_id = 3692 AND lat IS NULL;

-- 3693 DO NOT USE-New Tampa Maintenance (FL) [Census]
UPDATE branches SET lat = 28.194556, lng = -82.399123 WHERE aspire_branch_id = 3693 AND lat IS NULL;

-- 3695 Tampa North Maintenance (FL) [Census]
UPDATE branches SET lat = 28.331022, lng = -82.302480 WHERE aspire_branch_id = 3695 AND lat IS NULL;

-- 3698 Venice Maintenance (FL) [Census]
UPDATE branches SET lat = 26.967453, lng = -82.321024 WHERE aspire_branch_id = 3698 AND lat IS NULL;

-- 3702 Aquatics Central Florida (FL) [Census]
UPDATE branches SET lat = 28.165180, lng = -81.276279 WHERE aspire_branch_id = 3702 AND lat IS NULL;

-- 3704 West Orlando Aquatics (FL) [Census]
UPDATE branches SET lat = 28.499787, lng = -81.640732 WHERE aspire_branch_id = 3704 AND lat IS NULL;

-- 3705 Daytona Maintenance (FL) [Census]
UPDATE branches SET lat = 29.058171, lng = -81.298788 WHERE aspire_branch_id = 3705 AND lat IS NULL;

-- 3706 Hilton Head Maintenance (SC) [Census]
UPDATE branches SET lat = 32.220233, lng = -80.704346 WHERE aspire_branch_id = 3706 AND lat IS NULL;

-- 3707 Hilton Head Install (SC) [Census]
UPDATE branches SET lat = 32.220233, lng = -80.704346 WHERE aspire_branch_id = 3707 AND lat IS NULL;
