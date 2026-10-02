import type { Metadata } from "next";
import { Close } from "@/components/Close";
import { Reference } from "@/components/Reference";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Reference: every Pattern tool, input and setting",
  description:
    "The Pattern MCP tool reference: inputs, outputs, configuration and the command line. Register a design system, extract requirements, get a verdict, build, and verify the result.",
  alternates: { canonical: "/reference" },
};

export default function ReferencePage() {
  return (
    <div style={{ background: "#fff" }}>
      <TopBar />
      <main>
        <Reference />
      </main>
      <Close />
    </div>
  );
}
