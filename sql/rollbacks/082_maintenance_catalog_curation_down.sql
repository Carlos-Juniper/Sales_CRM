-- Rollback 082 — re-activate every service 082 deactivated.
-- Does not restore pre-082 inactive state for curated rows that were already
-- inactive before 082 ran (unknown). Safe for staging re-pull + re-apply.

UPDATE services SET active = 1 WHERE id IN (
    'maint-svc-50111', 'maint-svc-50150', 'maint-svc-50151', 'maint-svc-50152',
    'maint-svc-50153', 'maint-svc-50154', 'maint-svc-50155', 'maint-svc-50156',
    'maint-svc-50157', 'maint-svc-50158', 'maint-svc-50159', 'maint-svc-50160',
    'maint-svc-50161',
    'maint-svc-46821', 'maint-svc-46814', 'maint-svc-46817', 'maint-svc-46837',
    'maint-svc-50241',
    'maint-svc-23819',
    'maint-svc-23814', 'maint-svc-18893', 'maint-svc-30964', 'maint-svc-23807',
    'maint-svc-50243',
    'maint-svc-50213', 'maint-svc-50148', 'maint-svc-50199', 'maint-svc-50137',
    'maint-svc-23823', 'maint-svc-50168', 'maint-svc-50167', 'maint-svc-18892',
    'maint-svc-18907', 'maint-svc-50270', 'maint-svc-50269', 'maint-svc-50200',
    'maint-svc-50273', 'maint-svc-50400'
);
