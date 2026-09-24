import { AskBeforeBuilding } from "@/components/AskBeforeBuilding";
import { Close } from "@/components/Close";
import { FounderNote } from "@/components/FounderNote";
import { Hero } from "@/components/Hero";
import { IntegrationsStrip } from "@/components/IntegrationsStrip";
import { MakeItRequired } from "@/components/MakeItRequired";
import { ReceiptLedger } from "@/components/ReceiptLedger";
import { TopBar } from "@/components/TopBar";
import { TrustGrid } from "@/components/TrustGrid";

export default function Home() {
  return (
    <div style={{ background: "#fff" }}>
      <TopBar />
      <Hero />
      <IntegrationsStrip />
      <AskBeforeBuilding />
      <MakeItRequired />
      <ReceiptLedger />
      <TrustGrid />
      <FounderNote />
      <Close />
    </div>
  );
}
