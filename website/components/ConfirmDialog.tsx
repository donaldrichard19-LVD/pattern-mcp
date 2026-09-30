"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RED } from "./tokens";

// Measurements come from the registered Figma "Alert Dialog" (node 1861:670, Dir=None header):
// 320x224, radius 14, gap 16; header 140 (pad 16, gap 6, media tile 40x40 r6 pad 8, icon 24,
// title 24 high, description 40 high); footer 68 (pad 16, gap 8, buttons 36 high r10, 140 wide).
const DIALOG: CSSProperties = {
  width: 320,
  height: 224,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  overflow: "hidden",
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 0 0 1px var(--border-subtle), 0 12px 32px rgba(11, 15, 22, 0.18)",
  outline: "none",
};

const OVERLAY: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(11, 15, 22, 0.45)",
};

const FOCUSABLE = "button:not([disabled])";

type DialogButtonProps = {
  children: ReactNode;
  variant: "outline" | "destructive";
  onClick: () => void;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
};

function DialogButton({ children, variant, onClick, disabled, buttonRef }: DialogButtonProps) {
  const [hover, setHover] = useState(false);
  const [focusRing, setFocusRing] = useState(false);
  const destructive = variant === "destructive";
  const base = destructive
    ? { background: RED, color: "#fff", border: "1px solid " + RED }
    : { background: "#fff", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" };
  const hovered = destructive
    ? { background: "color-mix(in oklab, " + RED + " 88%, #000)", border: "1px solid color-mix(in oklab, " + RED + " 88%, #000)" }
    : { background: "var(--surface-sunken)" };
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocusRing(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocusRing(false)}
      style={{
        flex: 1,
        boxSizing: "border-box",
        height: 36,
        padding: "0 10px",
        borderRadius: 10,
        fontFamily: "inherit",
        fontSize: "var(--text-body-sm)",
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        ...base,
        ...(hover && !disabled ? hovered : null),
        ...(disabled ? { opacity: 0.5 } : null),
        outline: focusRing ? "2px solid var(--blue-500)" : "none",
        outlineOffset: 2,
      }}
    >
      {children}
    </button>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** Optional Media icon (24px). The Media tile renders only when this is passed. */
  icon?: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  /** Disables Confirm (e.g. while the destructive action is running). */
  pending?: boolean;
  cancelDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  icon,
  cancelLabel = "Cancel",
  confirmLabel = "Delete",
  pending = false,
  cancelDisabled = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => setMounted(true), []);

  // Focus moves to Cancel (the safe action) on open and returns to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => trigger?.focus();
  }, [open]);

  if (!open || !mounted) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!cancelDisabled) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    // Backdrop click intentionally does nothing: an alert dialog must be answered explicitly.
    <div style={OVERLAY}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={DIALOG}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "16px 16px 0", height: 140, boxSizing: "border-box" }}>
          <div style={{ height: 48 }}>
            {icon ? (
              <div
                style={{
                  width: 40,
                  height: 40,
                  boxSizing: "border-box",
                  padding: 8,
                  borderRadius: 6,
                  background: "var(--surface-sunken)",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {icon}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              id={titleId}
              style={{
                height: 24,
                lineHeight: "24px",
                fontSize: "var(--text-body-lg)",
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <div
              id={descId}
              style={{
                height: 40,
                lineHeight: "20px",
                fontSize: "var(--text-body-sm)",
                color: "var(--text-secondary)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {description}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: 16, height: 68, boxSizing: "border-box", marginTop: "auto" }}>
          <DialogButton variant="outline" onClick={onCancel} disabled={cancelDisabled} buttonRef={cancelRef}>
            {cancelLabel}
          </DialogButton>
          <DialogButton variant="destructive" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </DialogButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
