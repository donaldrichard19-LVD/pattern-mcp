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
  title: "Pattern: stop your AI agent from rebuilding components you already have",
  description:
    "Your agent doesn't know what's in your design system, so it often builds something new when a good one exists. Pattern checks first and tells the agent what to reuse and what's worth building.",
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
