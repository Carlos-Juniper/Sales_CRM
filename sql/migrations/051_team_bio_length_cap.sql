-- Migration 051 — Shorten team_members bios that overflow the proposal's
-- Meet Our Team card
--
-- studio/src/styles/proposal-print.css .team-card .bi clamps a bio to 12
-- lines (9.75pt/1.46 line-height across the ~5.5in column left of the 1.45in
-- photo). Alberto Toucet's (1103 chars) and Kyle Leverette's (1109 chars)
-- bios ran past that budget and rendered visibly cut off; Kyle McNamara's
-- (859 chars) was condensed too so all three sit well under the new
-- TEAM_MEMBER_BIO_MAX_LENGTH = 700 cap enforced on future writes by
-- api/settings.py TeamMemberCreate/TeamMemberPatch. Facts preserved from the
-- migration 030 originals — only length trimmed.

UPDATE `team_members`
   SET bio = 'Alberto Toucet began his career managing gas stations and convenience stores in Puerto Rico, and later owned and operated a food truck from 1999 to 2013. After transitioning into landscaping, he spent 11 years working his way up from field employee to branch manager.

His expertise includes people development, client relationship management, and lean operational efficiency. Alberto holds an FNGLA Certification and specializes in developing talent within his team to deliver exceptional client service.

As branch manager, Alberto oversees a $13 million book of business, ensuring his team provides top-tier service while building strong client relationships.'
 WHERE id = 'tm-bm-ftm-001';

UPDATE `team_members`
   SET bio = 'Kyle McNamara is a fourth-generation Floridian with over 20 years of experience in the green industry. He attended Indian River State College, where he played baseball, and later completed Fire Academy and EMT training, becoming State of Florida certified. His passion has always been designing, building, and maintaining large landscapes.

Kyle enjoys working with large developments, including a landscape design once featured in local news, where roughly 2,500 homeowners took holiday photos alongside the display.

Kyle and his wife have 3 children, and in his free time he enjoys the outdoors and coaching little league.'
 WHERE id = 'tm-rd-se-001';

UPDATE `team_members`
   SET bio = 'Kyle Leverette is from North Carolina, where he graduated from NC State with a degree in Turf Management. He grew up working golf courses and seasonal jobs cutting timber and Christmas trees, then spent 15 years at golf courses, rising from assistant to head superintendent, before Florida sod work and golf course construction back home.

When the economy collapsed in 2008, Kyle shifted to landscape maintenance and relocated to Florida, working on infrastructure, installation, and purchasing for a large local landscape company. He stays humble despite his many accolades over the past 3 years at Juniper.

Kyle lives in Cape Coral, where he enjoys boating, fishing, and golf.'
 WHERE id = 'tm-rd-sw-001';
