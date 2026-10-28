-- Why do Pattern servers start and never connect? Run in PostHog's SQL editor
-- (HogQL), one query at a time.
--
-- Uses the fields pattern_cli_exited has carried since 0.23.2: uptime_ms (how
-- long the process ran), stdin_bytes_read (bytes the client ever sent, never
-- the contents), node_major and platform. Older versions have none of them, so
-- every query filters to rows where uptime_ms is present.
--
-- The buckets read as follows:
--   probe_or_scanner   nothing sent and gone in under 3 s: something spawned the
--                      package and closed stdin, as a registry scanner or mirror does
--   idle_then_closed   nothing sent, but held open 3 s or more: a client that
--                      waited and gave up, or was abandoned
--   sent_data          the client wrote to stdin: it spoke to the server, so check
--                      query 3 for whether it ever completed a handshake
--
-- Known internal installs are excluded: they are this project's own test runs
-- from before telemetry was switched off in test scripts. Add more IDs as you
-- find them.

-- 1. Exit buckets by version, Node major and platform, last 30 days.
SELECT
  properties.version AS version,
  properties.node_major AS node_major,
  properties.platform AS platform,
  multiIf(
    properties.stdin_bytes_read > 0, 'sent_data',
    properties.uptime_ms < 3000, 'probe_or_scanner',
    'idle_then_closed'
  ) AS bucket,
  count() AS exits,
  uniq(distinct_id) AS installs
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND event = 'pattern_cli_exited'
  AND properties.uptime_ms IS NOT NULL
  AND distinct_id NOT IN (
    'bc046a05-1b78-42dc-85b7-5fd1d1466fc1',
    'efed24f6-8198-483e-be21-b6af40c74e8f',
    '635d3005-dde7-4b6d-9151-ae2e7695c229',
    'b7015aff-471f-40ba-bc9c-3f4d36b513e9',
    '38608132-7e93-4602-8e91-43f1adb4e782',
    '94a93607-ddce-43bf-a3ed-439e16d7ae5e'
  )
GROUP BY version, node_major, platform, bucket
ORDER BY version DESC, exits DESC
LIMIT 100

-- 2. How long do processes that were sent nothing stay up? A pile at 30 s means
--    clients timing out; a pile under 1 s means probes.
--
-- SELECT
--   multiIf(
--     properties.uptime_ms < 1000, '< 1 s',
--     properties.uptime_ms < 3000, '1-3 s',
--     properties.uptime_ms < 10000, '3-10 s',
--     properties.uptime_ms < 30000, '10-30 s',
--     properties.uptime_ms < 60000, '30-60 s',
--     '60 s +'
--   ) AS uptime_band,
--   count() AS exits,
--   uniq(distinct_id) AS installs
-- FROM events
-- WHERE timestamp >= now() - INTERVAL 30 DAY
--   AND event = 'pattern_cli_exited'
--   AND properties.stdin_bytes_read = 0
--   AND properties.uptime_ms IS NOT NULL
--   AND distinct_id NOT IN (
--     'bc046a05-1b78-42dc-85b7-5fd1d1466fc1',
--     'efed24f6-8198-483e-be21-b6af40c74e8f',
--     '635d3005-dde7-4b6d-9151-ae2e7695c229',
--     'b7015aff-471f-40ba-bc9c-3f4d36b513e9',
--     '38608132-7e93-4602-8e91-43f1adb4e782',
--     '94a93607-ddce-43bf-a3ed-439e16d7ae5e'
--   )
-- GROUP BY uptime_band
-- ORDER BY min(properties.uptime_ms)

-- 3. Installs that sent data but never completed a handshake. These reached the
--    server and did not finish `initialize`, which would point at a protocol or
--    client problem, not a probe.
--
-- SELECT
--   distinct_id,
--   max(properties.version) AS version,
--   sumIf(1, event = 'pattern_cli_exited' AND properties.stdin_bytes_read > 0) AS exits_with_data,
--   countIf(event = '$mcp_initialize') AS handshakes
-- FROM events
-- WHERE timestamp >= now() - INTERVAL 30 DAY
--   AND event IN ('pattern_cli_exited', '$mcp_initialize')
--   AND distinct_id NOT IN (
--     'bc046a05-1b78-42dc-85b7-5fd1d1466fc1',
--     'efed24f6-8198-483e-be21-b6af40c74e8f',
--     '635d3005-dde7-4b6d-9151-ae2e7695c229',
--     'b7015aff-471f-40ba-bc9c-3f4d36b513e9',
--     '38608132-7e93-4602-8e91-43f1adb4e782',
--     '94a93607-ddce-43bf-a3ed-439e16d7ae5e'
--   )
-- GROUP BY distinct_id
-- HAVING exits_with_data > 0 AND handshakes = 0
-- ORDER BY exits_with_data DESC
-- LIMIT 50
