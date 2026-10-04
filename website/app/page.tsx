import { AskBeforeBuilding } from "@/components/AskBeforeBuilding";
import { Close } from "@/components/Close";
import { FounderNote } from "@/components/FounderNote";
import { Hero } from "@/components/Hero";
import { IntegrationsStrip } from "@/components/IntegrationsStrip";
import { Problem } from "@/components/Problem";
import { MakeItRequired } from "@/components/MakeItRequired";
import { OneAuthority } from "@/components/OneAuthority";
import { ProofSection } from "@/components/ProofSection";
import { ReceiptLedger } from "@/components/ReceiptLedger";
import { Setup } from "@/components/Setup";
import { TopBar } from "@/components/TopBar";
import { TrustGrid } from "@/components/TrustGrid";

export default function Home() {
  return (
    <div style={{ background: "#fff" }}>
      <TopBar />
      <Hero />
      <Problem />
      <IntegrationsStrip />
      <OneAuthority />
      <AskBeforeBuilding />
      <ProofSection />
      <MakeItRequired />
      <ReceiptLedger />
      <TrustGrid />
      <Setup />
      <FounderNote />
      <Close />
    </div>
  );
}
