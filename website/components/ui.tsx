"use client";

import posthog from "posthog-js";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useReveal } from "./hooks";
import { MONO, PANEL } from "./tokens";

export function trackClick(event: string, props?: Record<string, string>) {
  posthog.capture(event, props);
}

export function Reveal({
  delay = 0,
  children,
  style,
}: {
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { ref, shown } = useReveal(delay);
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(20px)",
        transition: "opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1)",
        transitionDelay: delay + "ms",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CopyBlock({ lines, label, height }: { lines: string[]; label: string; height?: number }) {
  const [done, setDone] = useState(false);
  const text = lines.join("\n");
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
    trackClick("install_command_copied", { label });
  };
  return (
    <div style={{ ...PANEL, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "9px 12px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>{label}</span>
        <button
          onClick={copy}
          style={{
            ...MONO,
            fontSize: 11,
            cursor: "pointer",
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--border-subtle)",
            background: "#fff",
            color: "var(--text-secondary)",
          }}
        >
          {done ? "copied" : "copy"}
        </button>
      </div>
      <pre
        className="pt-json pt-scroll-x"
        style={{ margin: 0, padding: 12, height, ...MONO, fontSize: 12, lineHeight: 1.6, color: "var(--text-primary)", overflow: "auto" }}
      >
        {text}
      </pre>
    </div>
  );
}

type ChipTone = "neutral" | "accent" | "success" | "warning";

const CHIP_TONES: Record<ChipTone, { c: string; b: string; bg: string }> = {
  neutral: { c: "var(--text-secondary)", b: "var(--border-subtle)", bg: "#fff" },
  accent: { c: "var(--text-accent)", b: "color-mix(in oklab, var(--blue-500) 40%, transparent)", bg: "color-mix(in oklab, var(--blue-500) 8%, transparent)" },
  success: { c: "var(--text-success)", b: "color-mix(in oklab, var(--green-500) 40%, transparent)", bg: "color-mix(in oklab, var(--green-500) 9%, transparent)" },
  warning: { c: "var(--text-primary)", b: "color-mix(in oklab, var(--amber-500) 48%, transparent)", bg: "color-mix(in oklab, var(--amber-500) 12%, transparent)" },
};

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: ChipTone }) {
  const map = CHIP_TONES[tone];
  return (
    <span
      style={{
        ...MONO,
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: 999,
        color: map.c,
        border: "1px solid " + map.b,
        background: map.bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  style?: CSSProperties;
};

export function Button({ children, onClick, variant = "primary", size = "md", style }: ButtonProps) {
  const sizes = {
    sm: { padding: "7px 14px", fontSize: "var(--text-body-sm)" },
    md: { padding: "10px 18px", fontSize: "var(--text-body-md)" },
    lg: { padding: "13px 24px", fontSize: "var(--text-body-lg)" },
  }[size];
  const variants =
    variant === "primary"
      ? { background: "var(--text-primary)", color: "#fff", border: "1px solid var(--text-primary)" }
      : { background: "#fff", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" };
  return (
    <button
      onClick={onClick}
      style={{
        ...sizes,
        ...variants,
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontWeight: 500,
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <hr style={{ margin: 0, border: 0, borderTop: "1px solid var(--border-subtle)" }} />;
}

export function Mark({ size = 26 }: { size?: number }) {
  const BLUE = "var(--blue-500)";
  const GREEN = "var(--green-500)";
  const AMBER = "var(--amber-500)";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="26" height="12" rx="6" fill={BLUE} />
      <rect x="36" y="10" width="22" height="12" rx="6" fill={GREEN} opacity=".85" />
      <rect x="6" y="26" width="22" height="12" rx="6" fill={AMBER} />
      <rect x="32" y="26" width="26" height="12" rx="6" fill={BLUE} opacity=".55" />
      <rect x="6" y="42" width="30" height="12" rx="6" fill={GREEN} />
      <rect x="40" y="42" width="18" height="12" rx="6" fill={AMBER} opacity=".7" />
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span style={{ fontFamily: "var(--font-wordmark)", fontWeight: 900, letterSpacing: "-0.035em", fontSize: size, color: "var(--text-primary)" }}>
      Pattern
    </span>
  );
}
