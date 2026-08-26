"use client";

import { AlertTriangle, Check, CircleSlash, Code, Loader, Minus, MessageSquare, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useIsMobile, useScrollProgress } from "./hooks";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Chip } from "./ui";

const BEATS = [
  {
    title: "The agent reaches a design decision",
    body: "Mid-build, in a real project. This is where an agent needs to choose a component, but it has little context for what good looks like. It can grab something loosely related or invent a generic solution",
    label: "recommend_component",
  },
  {
    title: "Judgment against requirements, not keywords",
    body: "Pattern turns the component need into a requirements checklist, searches shadcn/ui and 21st.dev, and scores each requirement against the evidence it finds. The server recounts coverage from the checklist instead of trusting a stated percentage",
    label: "coverage scoring",
  },
  {
    title: "If a real component fits, it installs it",
    body: "A use_existing verdict includes the source, install command, and a description of what the component actually does. The description is based on the component Pattern found before anything is installed. The install command is untrusted text, so your agent shows it to you before running it",
    label: "verdict: use_existing",
  },
  {
    title: "If nothing fits, it builds from a real reference",
    body: "A custom_build verdict returns the checklist plus a grounded Mobbin or Figma Community reference. Deep links are verified server-side against a page that was actually fetched. When only a browse page exists, Pattern says so",
    label: "verdict: custom_build",
  },
  {
    title: "Some needs don't need a call",
    body: "Buttons, inputs, checkboxes, badges, spinners, tooltips, avatars, and icons are trivial primitives. A local skip-list catches them before any API request, so they add no API cost or latency",
    label: "reason: skip_list",
  },
  {
    title: "It remembers what this project already decided",
    body: "record_component_decision logs decisions the agent actually acted on, per project. A later call can use a similar past decision as a signal, never as a rule and never instead of searching and scoring again",
    label: "record_component_decision",
  },
];

const REQS = [
  { r: "Itemized line rows (rate, fees, taxes)", met: true },
  { r: "Nightly rate × nights subtotal", met: true },
  { r: "Collapsible fee explanation", met: false },
  { r: "Currency + locale formatting", met: false },
  { r: "Total row with emphasis", met: false },
  { r: "Discount / long-stay line", met: false },
  { r: "Tooltip on service fee", met: false },
  { r: "Mobile bottom-sheet layout", met: false },
];

type Row = { k: string; text: string };

const ICON: Record<string, LucideIcon> = {
  user: MessageSquare,
  call: Code,
  work: Loader,
  ok: Check,
  warn: AlertTriangle,
  skip: CircleSlash,
};
const TONE: Record<string, string> = {
  ok: "var(--text-success)",
  skip: "var(--text-tertiary)",
  work: "var(--text-secondary)",
};

function rowsForBeat(beat: number): Row[] {
  const rows: Row[] = [];
  if (beat === 0) {
    rows.push({ k: "user", text: "Build the price breakdown for the booking checkout: nightly rate, cleaning fee, service fee, taxes." });
    rows.push({ k: "call", text: 'recommend_component({ component_need: "price breakdown with fees and taxes", … })' });
  }
  if (beat === 1) {
    rows.push({ k: "work", text: "Searching shadcn/ui and 21st.dev · 2-search budget" });
  }
  if (beat === 2) {
    rows.push({ k: "ok", text: "6/8 (75%) covered by 21st.dev pricing-detail block" });
  }
  if (beat === 3) {
    rows.push({ k: "warn", text: "2/8 (25%), no candidate covers the itemized fee logic" });
  }
  if (beat === 4) {
    rows.push({ k: "user", text: "Also need a button for the confirm step." });
    rows.push({ k: "skip", text: "skip_list hit locally · 0 API calls · $0" });
  }
  if (beat === 5) {
    rows.push({ k: "call", text: 'record_component_decision({ project_id: "my-booking-app", action: "custom_built" })' });
    rows.push({ k: "ok", text: "past_decision_signal.considered: true" });
  }
  return rows;
}

function AgentThread({ beat }: { beat: number }) {
  const rows = rowsForBeat(beat);
  return (
    <div style={{ ...PANEL, background: "#fff", padding: 14, display: "grid", gap: 9, alignContent: "start", minHeight: 92 }}>
      {rows.map((r, i) => {
        const Icon = ICON[r.k] ?? MessageSquare;
        return (
          <div
            key={beat + "-" + i}
            className="pt-msg"
            style={{
              animationDelay: i * 80 + "ms",
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              fontSize: "var(--text-body-sm)",
              lineHeight: "var(--leading-body)",
              color: TONE[r.k] || "var(--text-primary)",
            }}
          >
            <Icon size={15} className={r.k === "work" ? "pt-spin" : undefined} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={r.k === "call" ? { ...MONO, fontSize: 11.5, wordBreak: "break-word" } : undefined}>{r.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function VerdictPanel({ beat, sub, compact }: { beat: number; sub: number; compact?: boolean }) {
  const shown = beat === 1 ? Math.max(1, Math.ceil(sub * REQS.length)) : REQS.length;
  const head = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-subtle)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>{BEATS[beat].label}</span>
      {beat === 2 && <Chip tone="success">use_existing · high</Chip>}
      {beat === 3 && <Chip tone="warning">custom_build · high</Chip>}
      {beat === 4 && <Chip>skip_list · $0</Chip>}
      {beat === 5 && <Chip tone="accent">memory · signal only</Chip>}
      {beat < 2 && <Chip tone="accent">scoring</Chip>}
    </div>
  );
  return (
    <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
      {head}
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        {beat <= 1 && (
          <div style={{ display: "grid", gap: 6 }}>
            {REQS.slice(0, shown).map((q, i) => (
              <div
                key={q.r}
                className="pt-msg"
                style={{
                  animationDelay: i * 50 + "ms",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: "var(--text-body-sm)",
                  color: q.met ? "var(--text-primary)" : "var(--text-tertiary)",
                }}
              >
                {q.met ? (
                  <Check size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-success)" }} />
                ) : (
                  <Minus size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-tertiary)" }} />
                )}
                <span>{q.r}</span>
              </div>
            ))}
          </div>
        )}
        {beat === 2 && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip tone="accent">source: 21st.dev</Chip>
              <Chip tone="success">coverage 6/8 (75%)</Chip>
            </div>
            <div style={{ ...PANEL, padding: 10 }}>
              <span style={{ ...MONO, fontSize: 11.5, color: "var(--text-primary)", wordBreak: "break-all" }}>
                npx shadcn@latest add &quot;https://21st.dev/r/pricing-detail-block&quot;
              </span>
            </div>
            {!compact && (
              <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>
                An itemized cost block with per-line labels, a subtotal, and an emphasized total row. Missing the collapsible fee explanation and the
                mobile bottom-sheet layout, both listed as unmet, not hidden.
              </p>
            )}
          </div>
        )}
        {beat === 3 && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip tone="warning">coverage 2/8 (25%)</Chip>
              <Chip>source: null</Chip>
            </div>
            {[
              { s: "Mobbin", t: "deep_link", d: "Booking, price details flow, itemized fees with an expandable service-fee row.", tone: "success" as const },
              { s: "Figma Community", t: "entry_point", d: "Browse page, not the file itself, so you'll need to search it. Said plainly, not dressed up.", tone: "neutral" as const },
            ]
              .slice(0, compact ? 1 : 2)
              .map((r) => (
                <div key={r.s} style={{ ...PANEL, padding: 10, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--text-body-sm)", color: "var(--text-primary)" }}>{r.s}</span>
                    <Chip tone={r.tone}>url_type: {r.t}</Chip>
                  </div>
                  <span style={{ fontSize: "var(--text-caption)", color: "var(--text-secondary)", lineHeight: "var(--leading-body)" }}>{r.d}</span>
                </div>
              ))}
          </div>
        )}
        {beat === 4 && (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>No API call, no search, no verdict to reason about. Caught locally against a static list of trivial primitives.</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["button", "input", "checkbox", "label", "badge", "spinner", "tooltip", "avatar", "icon"].slice(0, compact ? 6 : 9).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          </div>
        )}
        {beat === 5 && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ ...PANEL, padding: 10 }}>
              <pre className="pt-json" style={{ margin: 0, ...MONO, fontSize: 11.5, lineHeight: 1.6, color: "var(--text-primary)", overflow: "auto" }}>
                {['"my-booking-app": [{', '  "component_need": "price breakdown with fees and taxes",', '  "action": "custom_built",', '  "source": "custom"', "}]"].join(
                  "\n"
                )}
              </pre>
            </div>
            {!compact && (
              <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>
                Local plaintext, capped at the 50 most recent entries per project. Only decisions you confirm land here. A verdict you ignored leaves no
                trace.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BeatBar({ beat, onPick }: { beat: number; onPick?: (i: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {BEATS.map((b, i) => (
        <button
          key={b.title}
          onClick={() => onPick && onPick(i)}
          aria-label={b.title}
          style={{
            height: 14,
            flex: 1,
            padding: 0,
            border: 0,
            cursor: onPick ? "pointer" : "default",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            minHeight: 0,
          }}
        >
          <span style={{ height: 3, width: "100%", borderRadius: 2, background: i <= beat ? "var(--blue-500)" : "var(--border-subtle)", transition: "background .4s ease" }} />
        </button>
      ))}
    </div>
  );
}

function useBeat(ref: RefObject<HTMLElement | null>): [number, number, (n: number) => void] {
  const p = useScrollProgress(ref);
  const [manual, setManual] = useState<number | null>(null);
  const [auto, setAuto] = useState<number | null>(null);

  useEffect(() => {
    const el = document.scrollingElement || document.documentElement;
    if (el.scrollHeight - window.innerHeight > 40) return;
    setAuto(0);
    const t = setInterval(() => setAuto((v) => ((v === null ? 0 : v) + 1) % BEATS.length), 4200);
    return () => clearInterval(t);
  }, []);

  const raw = p * BEATS.length;
  const scrolled = Math.min(BEATS.length - 1, Math.floor(raw));
  const beat = manual !== null ? manual : auto !== null ? auto : scrolled;
  const sub = manual !== null || auto !== null ? 1 : Math.min(1, Math.max(0, raw - scrolled));
  return [beat, sub, setManual];
}

function DesktopDemo() {
  const wrap = useRef<HTMLElement | null>(null);
  const [beat, sub, pick] = useBeat(wrap);
  return (
    <section id="demo" ref={wrap} style={{ borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, padding: "72px 32px 0" }}>
        <div style={LABEL}>How it works</div>
      </div>
      <div className="pt-sec" style={{ ...SECTION, padding: "24px 32px 96px", display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 64, alignItems: "start" }}>
        <div className="pt-stage" style={{ display: "grid", gap: 12 }}>
          <AgentThread beat={beat} />
          <VerdictPanel beat={beat} sub={sub} />
          <BeatBar beat={beat} onPick={pick} />
        </div>
        <div style={{ display: "grid" }}>
          {BEATS.map((b, i) => (
            <div key={b.title} style={{ minHeight: "88vh", display: "flex", alignItems: "center" }}>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  maxWidth: 500,
                  transform: i === beat ? "none" : "translateY(12px)",
                  transition: "transform .5s cubic-bezier(.2,.7,.2,1)",
                }}
              >
                <h2 style={{ ...H2, fontFamily: "inherit", fontWeight: 500, color: "var(--text-primary)" }}>{b.title}</h2>
                <p style={{ ...BODY, fontSize: "var(--text-body-lg)", color: "var(--text-primary)" }}>{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MobileDemo() {
  const wrap = useRef<HTMLElement | null>(null);
  const [beat, sub, pick] = useBeat(wrap);
  const b = BEATS[beat];
  const stageStyle: CSSProperties = {
    position: "sticky",
    top: 60,
    height: "calc(100svh - 60px)",
    boxSizing: "border-box",
    padding: "12px 16px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflow: "hidden",
  };
  return (
    <section id="demo" ref={wrap} style={{ position: "relative", height: BEATS.length * 100 + "svh", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, padding: "20px 32px 0" }}>
        <div style={LABEL}>How it works</div>
      </div>
      <div className="pt-mstage" style={stageStyle}>
        <div style={{ flex: "0 1 auto", minHeight: 0, overflow: "hidden", display: "grid", alignContent: "start", gap: 10 }}>
          <VerdictPanel beat={beat} sub={sub} compact />
          <AgentThread beat={beat} />
        </div>
        <div key={beat} className="pt-msg" style={{ flex: "0 0 auto", paddingTop: 2 }}>
          <h2 style={{ ...H2, fontFamily: "inherit", fontWeight: 500, fontSize: "clamp(19px, 5.2vw, 26px)" }}>{b.title}</h2>
          <p style={{ ...BODY, margin: "4px 0 0", fontSize: "var(--text-body-sm)", lineHeight: 1.5, color: "var(--text-primary)" }}>{b.body}</p>
        </div>
        <div style={{ marginTop: "auto" }}>
          <BeatBar beat={beat} onPick={pick} />
        </div>
      </div>
    </section>
  );
}

export function ScrollDemo() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileDemo /> : <DesktopDemo />;
}
