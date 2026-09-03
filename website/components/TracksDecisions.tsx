"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "./hooks";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

type LiveStatus = "live" | "orphaned" | "unknown" | "pending";

const STATUS_STYLE: Record<LiveStatus, { label: string; color: string; border: string; bg: string }> = {
  live: { label: "live", color: "#7fe3b8", border: "rgba(14,159,110,.55)", bg: "rgba(14,159,110,.16)" },
  orphaned: { label: "orphaned", color: "#ffb3aa", border: "rgba(217,48,37,.55)", bg: "rgba(217,48,37,.16)" },
  unknown: { label: "unknown", color: "rgba(255,255,255,.72)", border: "rgba(255,255,255,.26)", bg: "rgba(255,255,255,.07)" },
  pending: { label: "not checked", color: "rgba(255,255,255,.45)", border: "rgba(255,255,255,.16)", bg: "transparent" },
};

type LedgerRow = {
  need: string;
  verdict: string;
  filePath: string;
  status: LiveStatus;
  resolvedStatus: LiveStatus;
  provenance: string;
};

const INITIAL_ROWS: LedgerRow[] = [
  {
    need: "price breakdown with fees and taxes",
    verdict: "custom_build",
    filePath: "app/checkout/PriceBreakdown.tsx",
    status: "pending",
    resolvedStatus: "live",
    provenance:
      "checklist: 8 requirements extracted\ncandidates_evaluated: 3 (shadcn/ui, 21st.dev, reui)\nverdict: custom_build, confidence high\nreason: no_candidates_found\nsnapshot_ref: a91f3c2 (2026-08-25)\nlast_verified_live: never — run the sweep to check this row",
  },
  {
    need: "host earnings dashboard",
    verdict: "use_existing",
    filePath: "app/host/Earnings.tsx",
    status: "pending",
    resolvedStatus: "orphaned",
    provenance:
      "checklist: 7 requirements extracted\ncandidates_evaluated: 1 (shadcn/ui data table)\nverdict: use_existing, confidence medium, coverage 5/7 (71%)\nsnapshot_ref: 8e21c40 (2026-08-25)\nlast_verified_live: never — run the sweep to check this row",
  },
  {
    need: "cancellation policy display",
    verdict: "custom_build",
    filePath: "app/stay/CancellationPolicy.tsx",
    status: "pending",
    resolvedStatus: "live",
    provenance:
      "checklist: 6 requirements extracted\ncandidates_evaluated: 2 (shadcn/ui, 21st.dev)\nverdict: custom_build, confidence high\nreason: scored, coverage 2/6 (33%)\nsnapshot_ref: 8e21c40 (2026-08-25)\nlast_verified_live: never — run the sweep to check this row",
  },
  {
    need: "host and guest messaging thread",
    verdict: "use_existing",
    filePath: "not recorded",
    status: "pending",
    resolvedStatus: "unknown",
    provenance: "no file_path recorded on this entry, nothing to check — the calling agent never reported one",
  },
];

function ThreeBarMark() {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 18 }} aria-hidden="true">
      <span style={{ width: 34, height: 8, borderRadius: 6, background: "var(--blue-500)" }} />
      <span style={{ width: 22, height: 8, borderRadius: 6, background: "var(--green-500)" }} />
      <span style={{ width: 14, height: 8, borderRadius: 6, background: "var(--amber-500)" }} />
    </div>
  );
}

function StatusPill({ status }: { status: LiveStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        padding: "4px 9px",
        borderRadius: 999,
        color: s.color,
        border: "1px solid " + s.border,
        background: s.bg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

const GRID_COLS = "1.4fr 1fr 1.2fr 130px 44px";

function ProvenancePanel({ row, mobile }: { row: LedgerRow; mobile?: boolean }) {
  return (
    <div style={{ padding: mobile ? "0 14px 14px" : "0 16px 16px" }}>
      <div
        className="pt-msg"
        style={{
          background: "rgba(255,255,255,.05)",
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 8,
          padding: mobile ? 12 : 14,
          fontFamily: "var(--font-mono)",
          fontSize: mobile ? 11 : 11.5,
          lineHeight: mobile ? 1.7 : 1.75,
          color: "rgba(255,255,255,.8)",
          whiteSpace: "pre-wrap",
        }}
      >
        {row.provenance}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: mobile ? 10.5 : 11, color: "rgba(255,255,255,.5)" }}>export_ledger_provenance</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: mobile ? 10.5 : 11, color: "rgba(255,255,255,.5)" }}>post_ledger_provenance_to_github</span>
      </div>
    </div>
  );
}

function LedgerRowView({
  row,
  open,
  onToggle,
}: {
  row: LedgerRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <span style={{ fontSize: 13.5, color: "#fff" }}>{row.need}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,.72)" }}>{row.verdict}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "rgba(255,255,255,.55)" }}>{row.filePath}</span>
        <StatusPill status={row.status} />
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Collapse provenance" : "Expand provenance"}
          style={{
            width: 30,
            height: 30,
            border: "1px solid rgba(255,255,255,.22)",
            borderRadius: 6,
            color: "#fff",
            background: "transparent",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {open && <ProvenancePanel row={row} />}
    </div>
  );
}

function LedgerCardView({
  row,
  open,
  onToggle,
}: {
  row: LedgerRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: 14, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 14, lineHeight: 1.35, color: "#fff" }}>{row.need}</span>
          <button
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Collapse provenance" : "Expand provenance"}
            style={{
              flex: "none",
              width: 34,
              height: 34,
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,.22)",
              background: "transparent",
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {open ? "−" : "+"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "rgba(255,255,255,.72)",
              border: "1px solid rgba(255,255,255,.18)",
              borderRadius: 999,
              padding: "3px 9px",
            }}
          >
            {row.verdict}
          </span>
          <StatusPill status={row.status} />
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,.5)", wordBreak: "break-all" }}>{row.filePath}</div>
      </div>
      {open && <ProvenancePanel row={row} mobile />}
    </div>
  );
}

const GRID: { h: string; p: string }[] = [
  {
    h: "Every decision tracks whether it was actually worth it",
    p: "report_build_cost attaches the real build cost after the fact, and report_outcome_proxy adds a value signal (reworked, time to merge, kept or replaced) computed from your own repo, deliberately independent of Pattern's own verdict.",
  },
  {
    h: "Old decisions get checked, not just logged",
    p: "check_ledger_liveness can confirm the file a decision was implemented in still exists and still uses what was recommended — that's the orphaned row above.",
  },
  {
    h: "Any decision can become a record you hand someone",
    p: "export_ledger_provenance turns one decision into a single markdown block. post_ledger_provenance_to_github can attach it straight to the PR or issue it belongs to.",
  },
  {
    h: "Older entries aren't left behind",
    p: "backfill_ledger_snapshot_ref reconstructs a snapshot_ref for entries written before this feature shipped, so liveness checks work retroactively, not just on decisions made from today forward.",
  },
];

export function TracksDecisions() {
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const isMobile = useIsMobile(720);

  const runSweep = () => {
    if (sweeping) return;
    setSweeping(true);
    setTimeout(() => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.status !== "pending") return r;
          const verified =
            r.resolvedStatus === "live"
              ? "last_verified_live: 2026-09-03 — file still exists and still references the recommended build"
              : r.resolvedStatus === "orphaned"
                ? "last_verified_live: 2026-09-03 — file_path no longer references the recommended component"
                : r.provenance.includes("no file_path recorded")
                  ? null
                  : "last_verified_live: 2026-09-03 — unable to confirm";
          return {
            ...r,
            status: r.resolvedStatus,
            provenance: verified
              ? r.provenance.replace("last_verified_live: never — run the sweep to check this row", verified)
              : r.provenance,
          };
        })
      );
      setSweeping(false);
    }, 1200);
  };

  return (
    <section className="pt-pad-y" style={{ padding: "64px 0", background: "#0b0f16", color: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 28 }}>
        <Reveal>
          <ThreeBarMark />
          <div
            style={{
              display: "flex",
              alignItems: isMobile ? "flex-start" : "flex-end",
              flexDirection: isMobile ? "column" : "row",
              justifyContent: "space-between",
              gap: isMobile ? 14 : 24,
              flexWrap: "wrap",
            }}
          >
            <h2
              style={{
                ...H2,
                color: "#fff",
                maxWidth: isMobile ? "26ch" : 680,
                fontSize: isMobile ? 28 : undefined,
                lineHeight: isMobile ? 1.1 : undefined,
              }}
            >
              Your agent made this decision. Here&apos;s the paper trail.
            </h2>
            <button
              onClick={runSweep}
              style={{
                border: "1px solid rgba(255,255,255,.28)",
                background: "transparent",
                color: "#fff",
                borderRadius: 6,
                padding: "11px 18px",
                minHeight: 44,
                width: isMobile ? "100%" : undefined,
                maxWidth: isMobile ? 280 : undefined,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {sweeping ? "sweeping…" : "Run sweep_ledger_liveness"}
            </button>
          </div>
          <p style={{ ...BODY, maxWidth: "70ch", fontSize: 15, color: "rgba(255,255,255,.66)", marginTop: 12 }}>
            Every judgment is pinned to the commit it was made against. Run the sweep to check each past decision
            against the files in the project as it stands now.
          </p>
        </Reveal>

        <Reveal delay={80}>
          {isMobile ? (
            <div style={{ display: "grid", gap: 10 }}>
              {rows.map((row, i) => (
                <LedgerCardView key={row.need} row={row} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
              ))}
            </div>
          ) : (
            <div style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 12, overflow: "hidden" }}>
              <div
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_COLS,
                  gap: 12,
                  padding: "10px 16px",
                  background: "rgba(255,255,255,.04)",
                  borderBottom: "1px solid rgba(255,255,255,.18)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-caps)",
                  color: "rgba(255,255,255,.55)",
                }}
              >
                <span>component_need</span>
                <span>verdict</span>
                <span>file_path</span>
                <span>live_status</span>
                <span aria-hidden="true" />
              </div>
              {rows.map((row, i) => (
                <LedgerRowView key={row.need} row={row} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
              ))}
            </div>
          )}
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginTop: 8 }}>
          {GRID.map((c, i) => (
            <Reveal key={c.h} delay={i * 70}>
              <div style={{ borderTop: "1px solid rgba(255,255,255,.24)", paddingTop: 14 }}>
                <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#fff", textWrap: "pretty" }}>{c.h}</h3>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,.6)" }}>{c.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
