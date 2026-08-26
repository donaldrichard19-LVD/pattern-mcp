import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Nunito } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://usepattern.sh"),
  title: "Pattern: contextual judgment for the components your agent picks",
  description:
    "Pattern gives coding agents better design judgment by searching real component libraries, checking options against your framework, product domain, and requirements, then giving them a recommendation they can act on while they build.",
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${jetbrainsMono.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
