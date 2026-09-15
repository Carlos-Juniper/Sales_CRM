-- ---------------------------------------------------------------------------
-- Migration 030 — Handoff 46 follow-up: replace placeholder team bios with
--   real, verbatim published bios; restore the deleted executive roster.
--
-- Background
-- ----------
-- Migration 015 (Handoff 37 Slice 3) seeded `team_members` with invented
-- placeholder bios. Migration 029 (Handoff 46 §5) deleted the fabricated
-- Carlos Hernandez founder bio (tm-exec-ceo-001) rather than publish it in a
-- client-facing PDF, and noted that the real executive page belongs to
-- Brandon Duke / Dan DeMont / Jake Rubin.
--
-- This migration does two things:
--   1. UPDATEs existing rows whose bio still equals the 015 placeholder — each
--      UPDATE is guarded on the exact old placeholder string so a real edit
--      entered later via the Settings admin UI is never clobbered on re-run.
--   2. INSERTs the full team roster (execs re-added; branch team members that
--      have real published bios but no prior row) using INSERT IGNORE on fixed
--      primary keys — safe to re-run.
--
-- Bio source
-- ----------
-- All bio text is copied VERBATIM from two Juniper published proposal PDFs:
--   • business docs/Pointe Jupiter Yacht Club.pdf  — pages 24–25
--   • business docs/Coral Bay HOA.pdf              — page 35
-- No text was paraphrased or invented. This satisfies the same principle
-- stated in migration 029: we do not fabricate copy attributed to real people.
--
-- Name canonicalisation
-- ---------------------
-- Names are set to EXACTLY match the headshot-slug lookup convention:
--   slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
-- Canonical strings required by the lookup (and used here):
--   Brandon Duke, Dan DeMont, Jake Rubin,
--   Kyle McNamara, Michelle Cady, Josh Burton,
--   Angela Girgado, Kyle Leverette, Alberto Toucet
--
-- Idempotent by construction: UPDATE … WHERE bio = '<exact placeholder>',
-- INSERT IGNORE with fixed PKs. Safe to re-run via scripts/migrate.py.
-- ---------------------------------------------------------------------------


-- ── §1  UPDATE existing rows — replace 015 placeholder bios ─────────────────
--
-- Only rows whose `bio` column still equals the verbatim 015 placeholder are
-- touched. If a real bio was entered via the Settings UI the guard fails
-- silently and the row is left unchanged.


-- §1.1  Michelle Cady  (tm-rd-east-001)
--   015 title: 'regional_director' / team_type: 'branch'
--   015 placeholder bio (exact):
--     Michelle oversees Juniper's East Coast regional operations, driving
--     consistent portfolio growth and client retention across Florida's eastern
--     corridor.
--   Source: Pointe Jupiter Yacht Club.pdf, page 25

UPDATE `team_members`
   SET bio = 'Michelle Cady has 32 years of green industry experience. Her love of landscaping started in 1993 working for one of Minnesota''s leading landscape companies, the first landcare company to go on the NYSE. She moved through the ranks and held several positions, including Operations Assistant, Nursery Sales, and Director of Landscape Maintenance, which gave her a well-diversified outlook. Furthermore, her bilingual skills added to her knowledge of many other departments, such as HR. Michelle had the unique opportunity of being the first female on the board of ALCA (now NALP).

In 2003, Michelle moved to Miami to live closer to family and later to Fort Myers for work as a business development executive for a national landscape company. Michelle had the honor of being inducted into the Latin American Who''s Who in 2011 for her achievements in advancing the culture of the Latino-American business community. Her commitment to honoring her word and dedication to quality and service brought her to Juniper in 2015.'
 WHERE id  = 'tm-rd-east-001'
   AND bio = 'Michelle oversees Juniper''s East Coast regional operations, driving consistent portfolio growth and client retention across Florida''s eastern corridor.';


-- §1.2  Alberto Toucet  (tm-bm-ftm-001)
--   015 name: 'Alberto Toucet Perez' — corrected to 'Alberto Toucet' to match
--   the published bio and the headshot-slug lookup expectation.
--   015 placeholder bio (exact):
--     Alberto oversees the Fort Myers Maintenance branch, ensuring consistent
--     service quality across the branch's commercial and HOA portfolio.
--   Source: Coral Bay HOA.pdf, page 35

UPDATE `team_members`
   SET name = 'Alberto Toucet',
       bio  = 'Alberto Toucet began his career managing multiple gas stations and convenience stores in Puerto Rico. He also owned and operated a food truck from 1999 to 2013. After transitioning into the landscaping industry, he has spent the past 11 years in various roles, starting as a field employee and working his way up to branch manager.

With 11 years of experience in the landscaping industry, his expertise includes people development and leadership, client relationship management, operational efficiency through lean practices, and beautification with proper maintenance techniques. Alberto specializes in developing talent within his team, helping individuals grow into roles they never thought possible. This has enabled him and his crew members to deliver exceptional client service. Alberto holds an FNGLA Certification and has a strong background in landscape beautification and proper maintenance techniques.

As the branch manager, Alberto currently oversees a $13 million book of business. He ensures that his team provides top-tier service while building client relationships and team development.'
 WHERE id  = 'tm-bm-ftm-001'
   AND bio = 'Alberto oversees the Fort Myers Maintenance branch, ensuring consistent service quality across the branch''s commercial and HOA portfolio.';


-- ── §2  INSERT executive team — re-add rows deleted by migration 029 ─────────
--
-- Migration 029 deleted tm-exec-ceo-001 rather than publish a fabricated bio.
-- Brandon Duke, Dan DeMont, and Jake Rubin are Juniper's real published
-- executive team. INSERT IGNORE on stable PKs following the tm-exec-* naming
-- convention already established in migration 015.
--
-- aspire_branch_id = NULL  → company-wide / executive roster (same semantics
--   as the original tm-exec-ceo-001 row, per migration 015 Amendment A.6).
-- user_id = NULL           → Settings admin UI links to real user records.
-- headshot_object_key = NULL → headshot upload handled via Settings UI.
-- Source: Pointe Jupiter Yacht Club.pdf, page 24


-- §2.1  Brandon Duke — Chief Executive Officer
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-exec-ceo-001',
 'Brandon Duke',
 'executive',
 'executive',
 NULL,
 NULL,
 'Florida',
 'Brandon Duke is Juniper''s Chief Executive Officer and has been in the landscape industry for nearly 15 years. After joining the family business in 2008, he purchased the company from his father in 2016. Under his leadership, Juniper has grown into the 17th largest landscaping company in the nation.

Since becoming CEO, Brandon has expanded Juniper from one location with 20 employees to 30+ locations across five states with more than 3,000 team members. He credits the company''s rapid growth to a strong culture of collaboration and innovation, supported by data-driven decision-making.

A Florida native and Business Management graduate of Liberty University—where he was a four-year football starter—Brandon values teamwork and leadership. He has been recognized among Lawn & Landscape''s Top 100 and was named 2022 Entrepreneur of the Year by Business Observer after leading significant revenue growth during the pandemic. He remains focused on culture, technology, and building a passionate team to set industry standards.',
 NULL,
 1, 0);


-- §2.2  Dan DeMont — Chief Revenue Officer
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-exec-cro-001',
 'Dan DeMont',
 'executive',
 'executive',
 NULL,
 NULL,
 'Florida',
 'Dan DeMont joined Juniper in 2011 as its first business developer, helping transform the company from a single branch into a growth-driven organization. He and Brandon launched Juniper''s Design, Build, and Maintain strategy—offering clients a fully accountable, single-source solution that quickly accelerated market share and new client growth.

Since then, Juniper has added hundreds of clients, balanced its construction and maintenance portfolio across residential, commercial, and government sectors, and expanded to 30+ locations across five states. Dan has also helped lead 15+ acquisitions, multiple greenfield expansions, and two recapitalizations.

He leads a team of landscape architects, designers, and client managers committed to Juniper''s core values and investment in its people. A recognized business and community leader, Dan has earned multiple design-build awards, a 40 Under 40 honor, and remains active in youth-focused organizations.',
 NULL,
 1, 1);


-- §2.3  Jake Rubin — Chief Operations Officer
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-exec-coo-001',
 'Jake Rubin',
 'executive',
 'executive',
 NULL,
 NULL,
 'Florida',
 'Jake Rubin is Juniper''s Chief Operating Officer, focused on driving peak operational performance through best practices across the organization. By partnering with branch teams, he has improved operating margins, increased efficiency, and elevated quality standards. He also collaborates with HR to deliver operational training programs companywide.

With over 15 years of leadership experience in private equity-backed, multi-state operations across transportation, construction, landscape, and commercial services, Jake brings deep expertise in margin improvement, M&A integration, and enterprise asset management. He is passionate about Juniper''s mission and ensuring processes best serve both team members and clients.',
 NULL,
 1, 2);


-- ── §3  INSERT branch team members with real published bios ──────────────────
--
-- Kyle McNamara, Josh Burton, Angela Girgado, and Kyle Leverette appear in the
-- published proposal PDFs but had no prior team_members rows. They are
-- inserted here so the headshot-slug lookup resolves for all nine people named
-- in this migration's scope. INSERT IGNORE on stable PKs is safe to re-run.
--
-- user_id = NULL  → Settings admin UI links to real user records.
-- headshot_object_key = NULL  → upload handled via Settings UI.


-- §3.1  Kyle McNamara — Regional Director, Southeast
--   Source: Pointe Jupiter Yacht Club.pdf, page 25
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-rd-se-001',
 'Kyle McNamara',
 'regional_director',
 'branch',
 NULL,   -- company-wide; Southeast region; aspire_branch_id NULL per A.6
 NULL,
 'Southeast Florida',
 'Kyle McNamara is a fourth-generation Floridian with over 20 years of experience in the green industry. He attended Indian River State College and was a member of their baseball team. Kyle attended Fire Academy and EMT training as well, becoming State of Florida certified. He chose to stay in the green industry since his passion has always been designing, building, and maintaining large landscapes.

Kyle enjoys working with large developments and had the privilege of being in the local news for a landscape design where approximately 2,500 homeowners took their holiday card photos alongside the Christmas display.

He is committed to providing high-quality customer service and finding solutions to clients'' landscape needs.

Kyle and his wife have 3 children, and during his free time, he enjoys exploring the outdoors with them and coaching little league.',
 NULL,
 1, 2);


-- §3.2  Josh Burton — Regional Director, Central
--   Source: Pointe Jupiter Yacht Club.pdf, page 25
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-rd-central-001',
 'Josh Burton',
 'regional_director',
 'branch',
 NULL,   -- company-wide; Central region; aspire_branch_id NULL per A.6
 NULL,
 'Central Florida',
 'Josh Burton is a native of Lakeland, Florida, who has been involved in the green industry since a very young age. He studied Horticultural Science and Business Administration at Florida Southern College where he obtained a Bachelor of Science degree. The green industry is Josh''s passion and led him to run his own landscape firm for 23 years.

Josh is a State Certified Irrigation Contractor, Certified Pest Control Operator and holds a license with the Department of Business and Professional Regulation. His strategy is to develop a plan, set goals, and hold accountability. Dissecting contracts and breaking down a property into segments allows for a calculated approach that will ultimately provide the high customer satisfaction that is expected.

Josh believes that building great teams and placing people in the right positions are the keys to success. He focuses on the development of the people around him to achieve his goals.',
 NULL,
 1, 3);


-- §3.3  Angela Girgado — Client Relations Manager, Fort Myers
--   Source: Coral Bay HOA.pdf, page 35
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-crm-ftm-001',
 'Angela Girgado',
 'account_manager',
 'branch',
 3696,   -- Fort Myers Maintenance
 NULL,
 'Fort Myers, FL',
 'As a Client Relationship Manager at Juniper Landscaping, Angela proudly serves communities throughout Southwest Florida by building strong, responsive partnerships with property managers and board members.

With a background in client development and operations, she brings a service-first mindset rooted in clear communication, accountability, and proactive planning. Angela works closely with each community to ensure expectations are aligned, service standards are consistently met, and concerns are addressed promptly and professionally.

She believes in being present, accessible, and solutions-focused. Her goal is not only to maintain beautiful landscapes, but to elevate them—creating long-term partnerships built on trust, transparency, and measurable results.',
 NULL,
 1, 1);


-- §3.4  Kyle Leverette — Regional Director, Southwest
--   Source: Coral Bay HOA.pdf, page 35
INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
('tm-rd-sw-001',
 'Kyle Leverette',
 'regional_director',
 'branch',
 NULL,   -- company-wide; Southwest region; aspire_branch_id NULL per A.6
 NULL,
 'Southwest Florida',
 'Kyle Leverette is from North Carolina and graduated from North Carolina State University with a degree in Turf Management. He grew up working on golf courses and doing seasonal jobs with Christmas trees in the fall and cutting timber in wintertime. After graduating with a degree in turfgrass management, Kyle spent 15 years at various golf courses working his way up from an assistant to the head superintendent. He had a brief stint of commercial sod work in Florida before moving back home to North Carolina for golf course construction.

When the economy collapsed in 2008, Kyle furthered his career by changing to landscape maintenance, eventually relocating back to Florida. There, he was involved with the infrastructure of a large local landscape company, working with commercial installation and purchasing. Kyle keeps himself humble despite having many accolades during the past 3 years at Juniper and considers everything as simply part of doing his job.

Kyle currently resides in Cape Coral, which provides him the perfect opportunity to enjoy his favorite pastimes of boating, fishing, and golf.',
 NULL,
 1, 3);
