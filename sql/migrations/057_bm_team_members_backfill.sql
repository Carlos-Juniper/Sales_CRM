-- Backfill team_members rows for the 11 branch managers who exist as CRM users
-- but have no team_members entry (so they were invisible in the proposal builder).
-- UUIDs are pre-generated so GCS headshot keys (proposal/headshots/{id}.{ext})
-- could be uploaded before this migration runs. Roger Kelley has no headshot yet
-- (NULL); all others carry their GCS key.
-- INSERT IGNORE: safe to re-run; duplicate id silently skips.
INSERT IGNORE INTO team_members
    (id, name, title, team_type, aspire_branch_id, user_id,
     location, bio, headshot_object_key, active, sort_order)
VALUES
    ('090a645b-0829-4c41-8456-37ac36ab8440', 'Alberto Toucet',   'manager', 'branch', 1403, '398230da-4334-4963-880c-a34ba16d5cbc', NULL, '', 'proposal/headshots/090a645b-0829-4c41-8456-37ac36ab8440.png', 1, 0),
    ('3ef73b53-b133-4c3e-9635-e49d17100ac2', 'Brennen Garrett',  'manager', 'branch', 1403, '76692f5d-98d4-4b2c-9085-4a88b8b90ed0', NULL, '', 'proposal/headshots/3ef73b53-b133-4c3e-9635-e49d17100ac2.png', 1, 0),
    ('08a03f2c-aabe-4892-a548-d9f51d60f90e', 'Catarino Martinez','manager', 'branch', 3697, '3c2bf1b9-e955-41dc-8e29-b2735aa58f5f', NULL, '', 'proposal/headshots/08a03f2c-aabe-4892-a548-d9f51d60f90e.png', 1, 0),
    ('fb34c235-69c8-4bf1-a0b4-f17168224498', 'Diego Cantu',      'manager', 'branch', 1374, '5924d85f-4d3c-40ef-be08-c9c89f887b3c', NULL, '', 'proposal/headshots/fb34c235-69c8-4bf1-a0b4-f17168224498.png', 1, 0),
    ('42d81c7e-9164-4d41-b304-e9c4cfe81eca', 'Eddie Tanguay',    'manager', 'branch', 1402, '58c9ac90-cbac-4cff-8ccc-98d7cd2ddaa0', NULL, '', 'proposal/headshots/42d81c7e-9164-4d41-b304-e9c4cfe81eca.png', 1, 0),
    ('8c9d93be-3cfc-4b11-af78-36102a96852c', 'Garth Rinard',     'manager', 'branch', 3691, '768a600b-e92a-4055-bee0-06b8944b864b', NULL, '', 'proposal/headshots/8c9d93be-3cfc-4b11-af78-36102a96852c.png', 1, 0),
    ('8d1a2da7-2829-4c42-ace1-a6917c8563fe', 'Juan Nova',        'manager', 'branch', 3663, '1a1a09ae-3cfa-464f-a9d0-6a66861e5ef7', NULL, '', 'proposal/headshots/8d1a2da7-2829-4c42-ace1-a6917c8563fe.jpg', 1, 0),
    ('3c4d65c9-9913-4093-aeea-06caf78461ba', 'Matt Hammond',     'manager', 'branch', 1412, 'f85ff28d-e266-47d4-b4a5-9aabbe59f845', NULL, '', 'proposal/headshots/3c4d65c9-9913-4093-aeea-06caf78461ba.png', 1, 0),
    ('c3172cac-9571-43c6-999c-a586cd203040', 'Matthew Gerich',   'manager', 'branch', 3677, '2bc19d99-7785-4ab4-9b13-10ff10f6fb25', NULL, '', 'proposal/headshots/c3172cac-9571-43c6-999c-a586cd203040.png', 1, 0),
    ('7f20abd4-241c-40e5-8ae7-f9ffc7c66411', 'Roger Kelley',     'manager', 'branch', 3671, '8fa625b7-5e66-48e6-81f9-66acc4da4e06', NULL, '', NULL,                                                             1, 0),
    ('18238a08-f8ba-4cbf-9add-72429c5f7d23', 'Todd Ruggles',     'manager', 'branch', 1374, 'e8ebb236-0f8a-4223-85c3-07250109b4c3', NULL, '', 'proposal/headshots/18238a08-f8ba-4cbf-9add-72429c5f7d23.png', 1, 0);
