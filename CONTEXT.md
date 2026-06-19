# Juniper CRM — Domain Glossary

## Core Entities

**HOA Property**
A homeowners association community managed by a property management company or self-managed. The unit of sales prospecting in the landscaping business. Has a pipeline status (Prospect → Bidding → Active / At Risk / Lost) and a separate contact status (uncontacted / contacted) that tracks whether outreach has ever occurred, independent of pipeline stage.

**Management Company (PM Company)**
A property management firm that manages one or more HOA properties. Treated as a CRM account with a relationship stage (Target → Engaged → Partner / Inactive) and an assigned sales rep. Has a roster of named contacts with titles. The primary outreach target when an HOA property is externally managed.

**PM Contact**
A named individual at a management company (e.g. Community Association Manager). Has name, title, email, phone. Stored in `hoa_contact_information` with `source = 'manual'` when entered via the UI.

**Lead**
A sales opportunity derived from an HOA Property. Created via promote. A property can have at most one active lead at a time. The `hoa_property_id` FK on a lead links the two.

**Bid**
A formal proposal tied to a Lead. When a bid reaches `pursuing` status, the associated property's `contact_status` flips to `contacted`.

**Account**
Umbrella term for either an HOA Property or a Management Company when viewed from the Accounts page. Not a distinct data model — just a UI navigation concept.

**Promote**
The act of converting an HOA Property into a Lead. A guard prevents creating a duplicate if an active lead already exists for the property. Does not change pipeline status; `contact_status` is set to `contacted` by downstream events (outreach sent, bid pursuing), not by the promote action itself.

**Contact Status**
A flag on HOA Properties and Management Companies tracking whether any outreach has ever occurred. Values: `uncontacted` / `contacted`. Set automatically on outreach send or bid→pursuing; also manually patchable by the rep.

**Pipeline Status (HOA)**
The current sales stage of an HOA Property: `Prospect`, `Bidding`, `Active`, `At Risk`, `Lost`. Managed manually by the rep. Automatically set to `Active` when an associated lead is marked won.

**Relationship Status (PM)**
The current relationship stage with a management company: `Target`, `Engaged`, `Partner`, `Inactive`. Managed manually by the rep.

**assigned_to**
A user ID (FK to `crm_users`) representing the sales rep who owns an HOA Property or Management Company. Consistent with the same field on Leads. Never stored as a display name.

**branch_id**
A string identifier for the Juniper branch responsible for an account (e.g. `"Fort Myers"`). The branch name doubles as the ID. Consistent across `hoa_properties`, `management_companies`, and `leads`.

**source**
Which system originally created an HOA Property record. Stored in `hoa_properties.source`. Values: `'arcgis'` (scraped from ArcGIS), `'aspire'` (imported from Aspire). Renamed from `arcgis_source` in migration 004 to be system-agnostic. Future scrapers add new values here rather than new columns.

**property_id**
An integer FK to Aspire's `PropertyID` on an HOA Property. Populated only for `source='aspire'` rows. NULL for ArcGIS-sourced rows. Enforces a unique constraint — prevents re-importing the same Aspire property twice.
