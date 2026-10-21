-- Strip the stray "#5" suffix from Additional Pruning.
-- The catalog id maint-svc-21186 is "Additional Pruning", not a fifth
-- pruning service. Idempotent. Apply with scripts/migrate.py — do not
-- run this file by hand against juniper-dev.

UPDATE services
   SET name = TRIM(REPLACE(name, ' #5', '')),
       display_name = CASE
         WHEN display_name IS NULL THEN NULL
         ELSE TRIM(REPLACE(display_name, ' #5', ''))
       END
 WHERE (id = 'maint-svc-21186' AND (name LIKE '%#5%' OR IFNULL(display_name, '') LIKE '%#5%'))
    OR name LIKE '%Additional Pruning #5%'
    OR name LIKE '%Additional pruning #5%'
    OR IFNULL(display_name, '') LIKE '%Additional Pruning #5%'
    OR IFNULL(display_name, '') LIKE '%Additional pruning #5%';

UPDATE section_services
   SET label = TRIM(REPLACE(label, ' #5', ''))
 WHERE (service_id = 'maint-svc-21186' AND label LIKE '%#5%')
    OR label LIKE '%Additional Pruning #5%'
    OR label LIKE '%Additional pruning #5%';
