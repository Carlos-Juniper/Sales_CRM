# Aspire raw responses - install service catalog extraction

Verbatim MCP response payloads from `mcp__aspire__aspire_query` against the Aspire REST API
(`cloud-api.youraspire.com`), captured 2026-09-30 UTC. **Read-only; nothing was written to Aspire.**

Each file is one response envelope exactly as returned:
`{"rows": [...], "row_count": N, "truncated": bool, "note": str|null, "offset": N, "has_more": bool, "next_offset": N|null, "total": null}`.
Rows are unmodified - no fields renamed, dropped, or filtered.

`scripts/data/aspire_install_service_catalog.json` is derived from **these files only**; rerunning the
derivation needs no Aspire access.

## Files

| file | endpoint | $filter | $orderby | paging | rows | UTC (approx, query issue time) | note |
|---|---|---|---|---|---|---|---|
| `divisions.json` | Divisions | `(none)` | `(none)` | `$top=200, $skip=0` | 22 | 2026-09-30T17:02:23Z |  |
| `opportunities_install.page1.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=100, $skip=0` | 45 | 2026-09-30T17:05:11Z | TRUNCATED: Result truncated at 45 of 100 rows (547.7 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunities_install.page2.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=45` | 45 | 2026-09-30T17:05:34Z |  |
| `opportunities_install.page3.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=90` | 45 | 2026-09-30T17:05:43Z |  |
| `opportunities_install.page4.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=135` | 45 | 2026-09-30T17:05:50Z |  |
| `opportunities_install.page5.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=180` | 45 | 2026-09-30T17:05:59Z |  |
| `opportunities_install.page6.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=225` | 35 | 2026-09-30T17:06:20Z | TRUNCATED: Result truncated at 35 of 45 rows (301.7 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunities_install.page7.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=270` | 45 | 2026-09-30T17:06:28Z |  |
| `opportunities_install.page8.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=315` | 45 | 2026-09-30T17:06:36Z |  |
| `opportunities_install.page9.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=360` | 30 | 2026-09-30T17:06:49Z | TRUNCATED: Result truncated at 30 of 45 rows (375.3 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunities_install.page10.json` | Opportunities | `startswith(DivisionCode,'IN-')` | `OpportunityID desc` | `$top=45, $skip=405` | 45 | 2026-09-30T17:06:57Z |  |
| `opportunity_service_groups.page1.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=200, $skip=0` | 168 | 2026-09-30T17:07:57Z | TRUNCATED: Result truncated at 168 of 200 rows (304.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_service_groups.page2.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=168` | 150 | 2026-09-30T17:08:21Z |  |
| `opportunity_service_groups.page3.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=318` | 150 | 2026-09-30T17:08:29Z |  |
| `opportunity_service_groups.page4.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=468` | 150 | 2026-09-30T17:08:36Z |  |
| `opportunity_service_groups.page5.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=618` | 150 | 2026-09-30T17:08:41Z |  |
| `opportunity_service_groups.page6.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=768` | 150 | 2026-09-30T17:08:46Z |  |
| `opportunity_service_groups.page7.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=918` | 150 | 2026-09-30T17:08:54Z |  |
| `opportunity_service_groups.page8.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1068` | 150 | 2026-09-30T17:09:09Z |  |
| `opportunity_service_groups.page9.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1218` | 150 | 2026-09-30T17:09:14Z |  |
| `opportunity_service_groups.page10.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1368` | 150 | 2026-09-30T17:09:24Z |  |
| `opportunity_service_groups.page11.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1518` | 150 | 2026-09-30T17:09:30Z |  |
| `opportunity_service_groups.page12.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1668` | 150 | 2026-09-30T17:09:35Z |  |
| `opportunity_service_groups.page13.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1818` | 150 | 2026-09-30T17:09:42Z |  |
| `opportunity_service_groups.page14.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=1968` | 150 | 2026-09-30T17:10:04Z |  |
| `opportunity_service_groups.page15.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=2118` | 150 | 2026-09-30T17:10:09Z |  |
| `opportunity_service_groups.page16.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=2268` | 150 | 2026-09-30T17:10:15Z |  |
| `opportunity_service_groups.page17.json` | OpportunityServiceGroups | `(none)` | `OpportunityServiceGroupID desc` | `$top=150, $skip=2418` | 150 | 2026-09-30T17:10:21Z |  |
| `opportunity_services.page1.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385000` | `OpportunityServiceID asc` | `$top=300, $skip=0` | 66 | 2026-09-30T17:11:34Z | TRUNCATED: Result truncated at 66 of 300 rows (1237.2 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page2.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386000 and OpportunityServiceGroupID lt 6386050` | `OpportunityServiceID asc` | `$top=200, $skip=0` | 35 | 2026-09-30T17:12:35Z |  |
| `opportunity_services.page3.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385500 and OpportunityServiceGroupID lt 6385590` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 72 | 2026-09-30T17:12:56Z | TRUNCATED: Result truncated at 72 of 105 rows (441.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page4.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385590 and OpportunityServiceGroupID lt 6385680` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 57 | 2026-09-30T17:12:57Z | TRUNCATED: Result truncated at 57 of 93 rows (426.8 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page5.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385680 and OpportunityServiceGroupID lt 6385770` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 93 | 2026-09-30T17:12:58Z | TRUNCATED: Result truncated at 93 of 257 rows (706.8 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page6.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385770 and OpportunityServiceGroupID lt 6385860` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 80 | 2026-09-30T17:13:00Z | TRUNCATED: Result truncated at 80 of 101 rows (312.8 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page7.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385860 and OpportunityServiceGroupID lt 6385950` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 92 | 2026-09-30T17:13:01Z | TRUNCATED: Result truncated at 92 of 186 rows (588.6 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page8.json` | OpportunityServices | `OpportunityServiceGroupID ge 6385950 and OpportunityServiceGroupID lt 6386040` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 84 | 2026-09-30T17:13:02Z | TRUNCATED: Result truncated at 84 of 127 rows (427.7 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page9.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386040 and OpportunityServiceGroupID lt 6386130` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 65 | 2026-09-30T17:13:23Z | TRUNCATED: Result truncated at 65 of 75 rows (283.5 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page10.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386130 and OpportunityServiceGroupID lt 6386220` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 54 | 2026-09-30T17:13:24Z | TRUNCATED: Result truncated at 54 of 96 rows (391.6 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page11.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386220 and OpportunityServiceGroupID lt 6386310` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 70 | 2026-09-30T17:13:26Z | TRUNCATED: Result truncated at 70 of 73 rows (262.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page12.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386310 and OpportunityServiceGroupID lt 6386400` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 49 | 2026-09-30T17:13:27Z | TRUNCATED: Result truncated at 49 of 160 rows (724.7 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page13.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386400 and OpportunityServiceGroupID lt 6386490` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 67 | 2026-09-30T17:13:28Z | TRUNCATED: Result truncated at 67 of 163 rows (751.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page14.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386490 and OpportunityServiceGroupID lt 6386580` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 53 | 2026-09-30T17:13:30Z | TRUNCATED: Result truncated at 53 of 165 rows (774.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page15.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386580 and OpportunityServiceGroupID lt 6386670` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 55 | 2026-09-30T17:13:31Z | TRUNCATED: Result truncated at 55 of 122 rows (640.3 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page16.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386670 and OpportunityServiceGroupID lt 6386760` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 64 | 2026-09-30T17:13:32Z | TRUNCATED: Result truncated at 64 of 115 rows (409.5 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page17.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386760 and OpportunityServiceGroupID lt 6386850` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 72 | 2026-09-30T17:13:47Z | TRUNCATED: Result truncated at 72 of 183 rows (878.4 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page18.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386850 and OpportunityServiceGroupID lt 6386940` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 43 | 2026-09-30T17:13:48Z | TRUNCATED: Result truncated at 43 of 167 rows (921.9 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page19.json` | OpportunityServices | `OpportunityServiceGroupID ge 6386940 and OpportunityServiceGroupID lt 6387030` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 65 | 2026-09-30T17:13:49Z | TRUNCATED: Result truncated at 65 of 179 rows (725.2 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page20.json` | OpportunityServices | `OpportunityServiceGroupID ge 6387030 and OpportunityServiceGroupID lt 6387120` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 52 | 2026-09-30T17:13:50Z | TRUNCATED: Result truncated at 52 of 92 rows (459.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page21.json` | OpportunityServices | `OpportunityServiceGroupID ge 6387120 and OpportunityServiceGroupID lt 6387210` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 92 | 2026-09-30T17:13:52Z | TRUNCATED: Result truncated at 92 of 181 rows (573.5 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page22.json` | OpportunityServices | `OpportunityServiceGroupID ge 6387210 and OpportunityServiceGroupID lt 6387300` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 51 | 2026-09-30T17:13:53Z | TRUNCATED: Result truncated at 51 of 154 rows (681.2 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page23.json` | OpportunityServices | `OpportunityServiceGroupID ge 6387300 and OpportunityServiceGroupID lt 6387390` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 43 | 2026-09-30T17:13:55Z | TRUNCATED: Result truncated at 43 of 144 rows (798.5 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page24.json` | OpportunityServices | `OpportunityServiceGroupID ge 6387390 and OpportunityServiceGroupID lt 6387480` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 42 | 2026-09-30T17:13:56Z | TRUNCATED: Result truncated at 42 of 79 rows (358.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page25.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385579 and OpportunityServiceGroupID lt 6385590` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 20 | 2026-09-30T17:14:29Z |  |
| `opportunity_services.page26.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385654 and OpportunityServiceGroupID lt 6385680` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 36 | 2026-09-30T17:14:29Z |  |
| `opportunity_services.page27.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385710 and OpportunityServiceGroupID lt 6385770` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 93 | 2026-09-30T17:14:31Z | TRUNCATED: Result truncated at 93 of 156 rows (429.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page28.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385835 and OpportunityServiceGroupID lt 6385860` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 21 | 2026-09-30T17:14:32Z |  |
| `opportunity_services.page29.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385926 and OpportunityServiceGroupID lt 6385950` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 65 | 2026-09-30T17:14:34Z | TRUNCATED: Result truncated at 65 of 91 rows (327.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page30.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385988 and OpportunityServiceGroupID lt 6386040` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 40 | 2026-09-30T17:14:35Z |  |
| `opportunity_services.page31.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386176 and OpportunityServiceGroupID lt 6386220` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 42 | 2026-09-30T17:14:37Z |  |
| `opportunity_services.page32.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386366 and OpportunityServiceGroupID lt 6386400` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 39 | 2026-09-30T17:14:47Z | TRUNCATED: Result truncated at 39 of 111 rows (474.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page33.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386438 and OpportunityServiceGroupID lt 6386490` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 49 | 2026-09-30T17:14:48Z | TRUNCATED: Result truncated at 49 of 93 rows (489.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page34.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386506 and OpportunityServiceGroupID lt 6386580` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 42 | 2026-09-30T17:14:49Z | TRUNCATED: Result truncated at 42 of 106 rows (502.7 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page35.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386625 and OpportunityServiceGroupID lt 6386670` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 38 | 2026-09-30T17:14:51Z | TRUNCATED: Result truncated at 38 of 60 rows (316.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page36.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386734 and OpportunityServiceGroupID lt 6386760` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 48 | 2026-09-30T17:14:52Z |  |
| `opportunity_services.page37.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386786 and OpportunityServiceGroupID lt 6386850` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 39 | 2026-09-30T17:14:53Z | TRUNCATED: Result truncated at 39 of 100 rows (572.3 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page38.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386866 and OpportunityServiceGroupID lt 6386940` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 41 | 2026-09-30T17:14:55Z | TRUNCATED: Result truncated at 41 of 118 rows (619.2 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page39.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386970 and OpportunityServiceGroupID lt 6387030` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 48 | 2026-09-30T17:15:00Z | TRUNCATED: Result truncated at 48 of 110 rows (458.3 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page40.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387078 and OpportunityServiceGroupID lt 6387120` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 33 | 2026-09-30T17:15:01Z |  |
| `opportunity_services.page41.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387162 and OpportunityServiceGroupID lt 6387210` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 78 | 2026-09-30T17:15:02Z | TRUNCATED: Result truncated at 78 of 88 rows (317.3 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page42.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387249 and OpportunityServiceGroupID lt 6387300` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 52 | 2026-09-30T17:15:04Z | TRUNCATED: Result truncated at 52 of 98 rows (411.1 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page43.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387330 and OpportunityServiceGroupID lt 6387390` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 39 | 2026-09-30T17:15:04Z | TRUNCATED: Result truncated at 39 of 101 rows (555.8 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page44.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387415 and OpportunityServiceGroupID lt 6387480` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 38 | 2026-09-30T17:15:06Z |  |
| `opportunity_services.page45.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385754 and OpportunityServiceGroupID lt 6385770` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 60 | 2026-09-30T17:15:56Z |  |
| `opportunity_services.page46.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386377 and OpportunityServiceGroupID lt 6386400` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 61 | 2026-09-30T17:16:01Z |  |
| `opportunity_services.page47.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386461 and OpportunityServiceGroupID lt 6386490` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 41 | 2026-09-30T17:16:02Z |  |
| `opportunity_services.page48.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386528 and OpportunityServiceGroupID lt 6386560` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 26 | 2026-09-30T17:16:03Z |  |
| `opportunity_services.page49.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386559 and OpportunityServiceGroupID lt 6386580` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 27 | 2026-09-30T17:16:05Z |  |
| `opportunity_services.page50.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386643 and OpportunityServiceGroupID lt 6386670` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 20 | 2026-09-30T17:16:06Z |  |
| `opportunity_services.page51.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386812 and OpportunityServiceGroupID lt 6386850` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 44 | 2026-09-30T17:16:17Z | TRUNCATED: Result truncated at 44 of 53 rows (293.6 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page52.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386895 and OpportunityServiceGroupID lt 6386940` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 57 | 2026-09-30T17:16:18Z | TRUNCATED: Result truncated at 57 of 76 rows (363.0 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page53.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386990 and OpportunityServiceGroupID lt 6387030` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 62 | 2026-09-30T17:16:20Z |  |
| `opportunity_services.page54.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387180 and OpportunityServiceGroupID lt 6387210` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 10 | 2026-09-30T17:16:21Z |  |
| `opportunity_services.page55.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387278 and OpportunityServiceGroupID lt 6387300` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 38 | 2026-09-30T17:16:22Z |  |
| `opportunity_services.page56.json` | OpportunityServices | `OpportunityServiceGroupID gt 6387347 and OpportunityServiceGroupID lt 6387390` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 49 | 2026-09-30T17:16:32Z | TRUNCATED: Result truncated at 49 of 61 rows (288.9 KB total). Add a WHERE clause, select fewer columns, or lower `limit`. |
| `opportunity_services.page57.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386127 and OpportunityServiceGroupID lt 6386130` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 2 | 2026-09-30T17:14:37Z |  |
| `opportunity_services.page58.json` | OpportunityServices | `OpportunityServiceGroupID gt 6386288 and OpportunityServiceGroupID lt 6386310` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 3 | 2026-09-30T17:14:47Z |  |
| `opportunity_services.page59.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385852 and OpportunityServiceGroupID lt 6385860` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 0 | 2026-09-30T17:16:00Z |  |
| `opportunity_services.page60.json` | OpportunityServices | `OpportunityServiceGroupID gt 6385937 and OpportunityServiceGroupID lt 6385950` | `OpportunityServiceID asc` | `$top=1000, $skip=0` | 18 | 2026-09-30T17:16:01Z |  |
| `opportunity_services.probe_desc_limit2.json` | OpportunityServices | `(none)` | `OpportunityServiceID desc` | `$top=2, $skip=0` | 2 | 2026-09-30T17:08:31Z |  |
| `service_types.json` | ServiceTypes | `(none)` | `(none)` | `$top=200, $skip=0` | 53 | 2026-09-30T17:02:23Z |  |
| `services.page1.json` | Services | `(none)` | `(none)` | `$top=200, $skip=0` | 200 | 2026-09-30T17:02:23Z |  |
| `services.page2.json` | Services | `(none)` | `(none)` | `$top=200, $skip=200` | 200 | 2026-09-30T17:02:45Z |  |
| `services.page3.json` | Services | `(none)` | `(none)` | `$top=200, $skip=400` | 200 | 2026-09-30T17:02:56Z |  |
| `services.page4.json` | Services | `(none)` | `(none)` | `$top=200, $skip=600` | 200 | 2026-09-30T17:03:04Z |  |
| `services.page5.json` | Services | `(none)` | `(none)` | `$top=200, $skip=800` | 200 | 2026-09-30T17:03:22Z |  |
| `services.page6.json` | Services | `(none)` | `(none)` | `$top=200, $skip=1000` | 76 | 2026-09-30T17:03:35Z |  |

Total archived rows: **7081** across **96** responses.

## Reading notes

* **`note` = TRUNCATED** means the MCP transport capped the response at roughly 250 KB and returned
  fewer rows than Aspire would have. Those gaps were filled with follow-up `$filter` range windows
  (the `gt <id> and ... lt <id>` rows below the primary 90-wide windows). Some gaps remain - see the
  `caveats` array in the distilled JSON.
* **Aspire REST limits learned here**: no `$count`/`total` is ever returned, so no population figure is
  knowable. Server-side `$filter` DOES work for `startswith(DivisionCode,'IN-')`, `OpportunityServiceGroupID
  ge/gt/lt <int>` and `X and Y` conjunctions of those; it does NOT work for long `or` chains of
  `ServiceTypeID eq N` (HTTP 400). `$top` above ~200 is ignored by the server for wide tables.
* **`mcp__aspire__mssql_*` was down** for the whole extraction (every call times out), so none of this was
  cross-checked against the SQL replica.
* **Deduplicate on the primary key when concatenating pages** - overlapping windows repeat rows.
  Keys: `DivisionID`, `ServiceTypeID`, `ServiceID`, `OpportunityID`, `OpportunityServiceGroupID`,
  `OpportunityServiceID`.
* **`divisions.json` and `service_types.json`** were small enough to return inline rather than being
  written to disk by the tool; they were transcribed verbatim from the response, envelope included.
  Same for `opportunity_services.page{57,58,59,60}.json` and
  `opportunity_services.probe_desc_limit2.json`.
* **One response was NOT archived**: a schema probe `Opportunities $orderby=OpportunityID desc&$top=3`
  (3 rows). Its one install row, OpportunityID 2902847, is in `opportunities_install.page1.json`; its two
  maintenance rows (2902848, 2902846, division MT-IR) are out of scope and were not transcribed.

## Derivation (how the distilled JSON is produced)

1. Concatenate + dedupe each endpoint's pages on its primary key.
2. Install divisions := `Divisions` where `DivisionCode` starts with `IN-` (7 rows).
3. Install ServiceTypes := `ServiceTypes` whose `DivisionID` is one of those (23 rows).
4. Install Services := `Services` whose `ServiceTypeID` is one of those (48 rows, inactive included).
5. Install opportunities := all rows of `opportunities_install.*` (the `$filter` already restricts them).
6. Install service groups := `OpportunityServiceGroups` rows whose `OpportunityID` is in (5).
7. Install opportunity services := `OpportunityServices` rows whose `OpportunityServiceGroupID` is in (6).
8. Group vocabulary := group by `GroupName` lowercased with whitespace collapsed; keep raw strings.
