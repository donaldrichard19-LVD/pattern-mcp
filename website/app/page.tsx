import { DecisionBoard } from '@/components/site/decision-board'
import { Faq } from '@/components/site/faq'
import { FeatureGrid } from '@/components/site/feature-grid'
import { Hero } from '@/components/site/hero'
import { InstallCta } from '@/components/site/install-cta'
import { ProofWindow } from '@/components/site/proof-window'
import { ReceiptSection } from '@/components/site/receipt-section'
import { RuleSection } from '@/components/site/rule-section'
import { SiteFooter } from '@/components/site/site-footer'
import { TerminalSetup } from '@/components/site/terminal-setup'
import { TopNav } from '@/components/site/top-nav'

export default function Page() {
  return (
    <>
      <TopNav />
      <main>
        <Hero />
        <DecisionBoard />
        <TerminalSetup />
        <ProofWindow />
        <RuleSection />
        <FeatureGrid />
        <ReceiptSection />
        <InstallCta />
        <Faq />
      </main>
      <SiteFooter />
    </>
  )
}
