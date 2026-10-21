-- Rollback 083 — put the "#5" suffix back only when the cleaned label is
-- exactly "Additional Pruning" or "Additional pruning".

UPDATE services
   SET name = CASE name
         WHEN 'Additional pruning' THEN 'Additional pruning #5'
         ELSE 'Additional Pruning #5'
       END
 WHERE id = 'maint-svc-21186'
   AND name IN ('Additional Pruning', 'Additional pruning');

UPDATE services
   SET display_name = CASE display_name
         WHEN 'Additional pruning' THEN 'Additional pruning #5'
         ELSE 'Additional Pruning #5'
       END
 WHERE id = 'maint-svc-21186'
   AND display_name IN ('Additional Pruning', 'Additional pruning');

UPDATE section_services
   SET label = CASE label
         WHEN 'Additional pruning' THEN 'Additional pruning #5'
         ELSE 'Additional Pruning #5'
       END
 WHERE service_id = 'maint-svc-21186'
   AND label IN ('Additional Pruning', 'Additional pruning');
