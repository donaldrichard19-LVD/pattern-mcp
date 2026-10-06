import { AskBeforeBuilding } from "@/components/AskBeforeBuilding";
import { Close } from "@/components/Close";
import { Cost } from "@/components/Cost";
import { Faq } from "@/components/Faq";
import { FounderNote } from "@/components/FounderNote";
import { Grid } from "@/components/Grid";
import { Hero } from "@/components/Hero";
import { MakeItRequired } from "@/components/MakeItRequired";
import { SeeTheProof } from "@/components/SeeTheProof";
import { Setup } from "@/components/Setup";
import { TopBar } from "@/components/TopBar";

export default function Home() {
  return (
    <div style={{ background: "#fff" }}>
      <TopBar />
      <Hero />
      <Grid />
      <AskBeforeBuilding />
      <SeeTheProof />
      <MakeItRequired />
      <Cost />
      <Setup />
      <Faq />
      <FounderNote />
      <Close />
    </div>
  );
}
