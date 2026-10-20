// Known-bad implementations for verify_component.
//
// One good component (ConfirmDialog), a fixed 8-item checklist it satisfies,
// and variants made by ONE textual edit each, so exactly one thing differs from
// the baseline. A pass is only meaningful if the tool can fail: these are the
// cases it should fail (or at least refuse to pass) and the controls it
// should not fail.
//
// Groups:
//   defect      single seeded defect. `target` is the 1-based checklist item the
//               defect breaks; `expect` is "fail" (clearly wrong in the code) or
//               "not_pass" (fail or unverified are both acceptable, a pass is a miss).
//   control     the unmodified baseline: every item should pass; a "fail" is a
//               false positive.
//   probe       informational only (ambiguous by design); statuses are reported, not scored.
//
// `alsoAffects` lists other items the same edit legitimately breaks, so those
// do not count as collateral false failures.

export const COMPONENT_NAME = "ConfirmDialog";

export const CHECKLIST = [
  'Dialog container has role="alertdialog" and aria-labelledby referencing the title element\'s id',
  "Pressing Escape calls onCancel",
  "Focus moves into the dialog on open and returns to the trigger element on close",
  "The dialog is exactly 320px wide",
  "Clicking the backdrop calls onCancel and never onConfirm",
  "The confirm action uses the danger button variant and the cancel action uses the secondary variant",
  "No hard-coded color values (no hex, rgb or named colors) anywhere in the component",
  "A Cancel button and a Confirm button are both rendered, each wired to its own handler",
];

export const BASELINE = `import { useEffect, useRef } from "react";
import { Button } from "./Button";

type Props = {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  triggerRef: React.RefObject<HTMLElement>;
};

export function ConfirmDialog({ title, message, onConfirm, onCancel, triggerRef }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => triggerRef.current?.focus();
  }, [triggerRef]);

  return (
    <div className="backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        style={{ width: 320 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Delete</Button>
      </div>
    </div>
  );
}
`;

const KEY_BLOCK = `        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
`;
const STYLE = "style={{ width: 320 }}";
const CONFIRM_BTN = `<Button variant="danger" onClick={onConfirm}>Delete</Button>`;
const CANCEL_BTN = `        <Button variant="secondary" onClick={onCancel}>Cancel</Button>\n`;

// edit: [from, to]; `from` must occur exactly once in BASELINE (checked by buildVariants).
export const VARIANTS = [
  { name: "baseline", group: "control", description: "Unmodified, correct component", edit: null, target: null,
    mustContain: ['role="alertdialog"', 'e.key === "Escape") onCancel()'], mustNotContain: [] },

  // --- Item 2: Escape cancels (the "right props, wrong behavior" family)
  { name: "escape-missing", group: "defect", description: "No key handler at all", edit: [KEY_BLOCK, ""], target: 2, expect: "fail",
    mustNotContain: ["Escape", "onKeyDown"] },
  { name: "escape-wrong-handler", group: "defect", description: "Escape is handled but calls onConfirm (right props, wrong behavior)",
    edit: ['if (e.key === "Escape") onCancel();', 'if (e.key === "Escape") onConfirm();'], target: 2, expect: "fail",
    mustContain: ['"Escape") onConfirm()'], mustNotContain: ['"Escape") onCancel()'] },
  { name: "escape-dead-code", group: "defect", description: "Escape handler is defined but never attached to anything",
    edit: [KEY_BLOCK, ""], extra: (src) => src.replace("  return (\n", `  const handleKey = (e: React.KeyboardEvent) => {\n    if (e.key === "Escape") onCancel();\n  };\n\n  return (\n`),
    target: 2, expect: "not_pass", mustContain: ["handleKey"], mustNotContain: ["onKeyDown"] },
  { name: "escape-comment-only", group: "defect", description: "A comment claims Escape works; there is no code",
    edit: [KEY_BLOCK, "        // Escape closes the dialog (handled by the browser)\n"], target: 2, expect: "not_pass",
    mustContain: ["// Escape closes the dialog"], mustNotContain: ["onKeyDown"] },

  // --- Item 3: focus management
  { name: "focus-no-return", group: "defect", description: "Focus moves in on open but is never returned to the trigger",
    edit: ["    return () => triggerRef.current?.focus();\n", ""], target: 3, expect: "fail", mustNotContain: ["triggerRef.current"] },
  { name: "focus-no-move", group: "defect", description: "Focus returns on close but never moves into the dialog on open",
    edit: ["    dialogRef.current?.focus();\n", ""], target: 3, expect: "fail", mustNotContain: ["dialogRef.current"] },

  // --- Item 4: a stated number
  { name: "width-wrong", group: "defect", description: "Width is 360, requirement says exactly 320",
    edit: [STYLE, "style={{ width: 360 }}"], target: 4, expect: "fail", mustContain: ["width: 360"], mustNotContain: ["width: 320"] },

  // --- Item 5: backdrop
  { name: "backdrop-confirms", group: "defect", description: "Clicking the backdrop confirms (destructive) instead of cancelling",
    edit: [`<div className="backdrop" onClick={onCancel}>`, `<div className="backdrop" onClick={onConfirm}>`], target: 5, expect: "fail",
    mustContain: ['className="backdrop" onClick={onConfirm}'] },

  // --- Item 6: variants
  { name: "variant-wrong", group: "defect", description: "Confirm uses the primary variant, not danger",
    edit: [CONFIRM_BTN, `<Button variant="primary" onClick={onConfirm}>Delete</Button>`], target: 6, expect: "fail", mustNotContain: ['variant="danger"'] },

  // --- Item 7: must-be-ABSENT requirement
  { name: "hex-color", group: "defect", description: "Hard-coded hex color",
    edit: [STYLE, `style={{ width: 320, color: "#d32f2f" }}`], target: 7, expect: "fail", mustContain: ["#d32f2f"] },
  { name: "named-color", group: "defect", description: "Hard-coded named color (harder to find by literal search)",
    edit: [STYLE, `style={{ width: 320, background: "white" }}`], target: 7, expect: "fail", mustContain: ['background: "white"'] },

  // --- Item 8: wiring
  { name: "confirm-miswired", group: "defect", description: "Confirm button calls onCancel (both buttons present, one is wired wrong)",
    edit: [CONFIRM_BTN, `<Button variant="danger" onClick={onCancel}>Delete</Button>`], target: 8, expect: "fail", mustNotContain: ["onClick={onConfirm}>Delete"] },
  { name: "cancel-missing", group: "defect", description: "No Cancel button at all",
    edit: [CANCEL_BTN, ""], target: 8, expect: "fail", alsoAffects: [6], mustNotContain: [">Cancel<"] },

  // --- Informational probe: equivalent but not literally checkable from the file
  { name: "width-tailwind-class", group: "probe", description: "w-80 is 320px with default Tailwind, but the file cannot prove it",
    edit: [STYLE, `className="w-80"`], target: 4, expect: "any", mustContain: ["w-80"], mustNotContain: ["width: 320"] },
];

/** Applies each variant's edit to the baseline; throws if an edit's `from` does not occur exactly once. */
export function buildVariants() {
  return VARIANTS.map((v) => {
    let src = BASELINE;
    if (v.edit) {
      const [from, to] = v.edit;
      const n = src.split(from).length - 1;
      if (n !== 1) throw new Error(`variant "${v.name}": edit target occurs ${n} times (need exactly 1): ${JSON.stringify(from.slice(0, 60))}`);
      src = src.replace(from, () => to);
    }
    if (v.extra) src = v.extra(src);
    return { ...v, source: src };
  });
}
