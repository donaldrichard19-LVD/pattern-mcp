-- Pattern activation funnel, per install, over the last 30 days. Run in
-- PostHog's SQL editor (HogQL).
--
-- Counts only handshakes from real coding agents. Before this, ~all recorded
-- handshakes and tool calls came from this repo's own verify-*/eval scripts
-- and from third-party scanners (e.g. policylayer-crawler, schema-drift-probe),
-- which made the funnel look healthy. Add real client names to the allowlist
-- below; run the "unclassified clients" query underneath to see anything new.
--
-- Stages, each a subset of the one before it:
-- Caveat: an install ID that both ran test scripts and used a real client
-- (a developer's own machine) still counts as real -- exclude known internal
-- IDs here if that matters for the number you are reporting.
--
--   ran_init -> real_handshake -> real_tool_call -> returned (2+ distinct days with a real tool call)

WITH real_client AS (
  SELECT distinct_id
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event = '$mcp_initialize'
    AND (
      properties.$mcp_client_name IN ('claude-code', 'claude-ai', 'claude-desktop', 'cursor', 'codex', 'windsurf', 'zed', 'cline', 'vscode')
      OR properties.$mcp_client_name LIKE 'local-agent-mode%'
    )
  GROUP BY distinct_id
)
SELECT
  uniqIf(distinct_id, did_init)                                      AS ran_init,
  uniqIf(distinct_id, did_handshake)                                 AS real_handshake,
  uniqIf(distinct_id, did_handshake AND did_tool_call)               AS real_tool_call,
  uniqIf(distinct_id, did_handshake AND did_tool_call AND days >= 2) AS returned
FROM (
  SELECT
    distinct_id,
    countIf(event = 'pattern_cli_started' AND properties.mode = 'init') > 0 AS did_init,
    distinct_id IN (SELECT distinct_id FROM real_client)                    AS did_handshake,
    countIf(event = '$mcp_tool_call') > 0                                   AS did_tool_call,
    uniqIf(toDate(timestamp), event = '$mcp_tool_call')                     AS days
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event IN ('pattern_cli_started', '$mcp_initialize', '$mcp_tool_call')
  GROUP BY distinct_id
)

-- Unclassified clients (run separately): anything here is neither on the
-- allowlist nor obviously internal -- decide whether it is a real agent.
--
-- SELECT properties.$mcp_client_name AS client, count() AS handshakes, uniq(distinct_id) AS installs
-- FROM events
-- WHERE timestamp >= now() - INTERVAL 30 DAY AND event = '$mcp_initialize'
--   AND properties.$mcp_client_name NOT IN ('claude-code', 'claude-ai', 'claude-desktop', 'cursor', 'codex', 'windsurf', 'zed', 'cline', 'vscode')
--   AND properties.$mcp_client_name NOT LIKE 'local-agent-mode%'
--   AND properties.$mcp_client_name NOT LIKE 'verify-%'
-- GROUP BY client ORDER BY handshakes DESC
