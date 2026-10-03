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
  title: "Pattern: your agent answers to your design system",
  description:
    "Before your agent builds a screen, Pattern checks the request against your own design system, reuses what fits, and lists exactly what's missing. Afterwards it checks the code and shows the proof.",
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
