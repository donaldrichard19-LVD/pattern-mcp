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
  title: "Pattern: catch the wrong UI decision before your agent builds it",
  description:
    "Pattern checks a UI component need against real, current evidence before your agent commits to it. It finds a component that fits or shows you when nothing does, so you find out before it's built, not after.",
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
