import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are served from the repo, not fetched from Google at build time. On
// 2026-09-22 the production build could not reach fonts.gstatic.com, failed,
// and production silently kept serving the previous commit. A build should
// not depend on a network call it does not need. Files from Fontsource
// (@fontsource-variable/inter, @fontsource/fraunces 5.3.0), SIL OFL 1.1 —
// licences alongside in ./fonts.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fraunces-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "TD Hub — Pacific Coast Title",
  description: "Transaction management platform for Pacific Coast Title Company",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${fraunces.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
