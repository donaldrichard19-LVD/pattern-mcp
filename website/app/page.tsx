import { AvoidsMistakes } from "@/components/AvoidsMistakes";
import { Close } from "@/components/Close";
import { Guidance } from "@/components/Guidance";
import { Hero } from "@/components/Hero";
import { Reference } from "@/components/Reference";
import { SavesTime } from "@/components/SavesTime";
import { ScrollDemo } from "@/components/ScrollDemo";
import { TopBar } from "@/components/TopBar";
import { TracksDecisions } from "@/components/TracksDecisions";

export default function Home() {
  return (
    <div style={{ background: "#fff" }}>
      <TopBar />
      <Hero />
      <ScrollDemo />
      <SavesTime />
      <AvoidsMistakes />
      <TracksDecisions />
      <Reference />
      <Guidance />
      <Close />
    </div>
  );
}
