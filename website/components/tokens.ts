import type { CSSProperties } from "react";

export const SECTION: CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: "0 32px" };

export const MONO: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

export const WORDMARK: CSSProperties = {
  fontFamily: "var(--font-wordmark)",
  fontWeight: 900,
  letterSpacing: "-0.035em",
};

export const LABEL: CSSProperties = {
  fontSize: "var(--text-micro)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

export const H2: CSSProperties = {
  margin: 0,
  fontWeight: 500,
  fontSize: "clamp(26px, 4vw, var(--text-display-sm))",
  lineHeight: "var(--leading-display)",
  letterSpacing: "var(--tracking-display)",
  color: "var(--text-primary)",
  textWrap: "pretty",
};

export const BODY: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-body-md)",
  lineHeight: "var(--leading-body)",
  color: "var(--text-secondary)",
  textWrap: "pretty",
};

export const PANEL: CSSProperties = {
  background: "var(--surface-sunken)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
};

export const BLUE = "var(--blue-500)";
export const GREEN = "var(--green-500)";
export const AMBER = "var(--amber-500)";
