import localFont from "next/font/local";
import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
const instrument = localFont({
  src: "./fonts/InstrumentSerif-Regular.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-instrument-serif",
});
export const metadata: Metadata = {
  title: "MediaFlock",
  description:
    "Create, approve, distribute and learn from account-specific content.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${instrument.variable}`}
      data-theme="light"
    >
      <body>{children}</body>
    </html>
  );
}
