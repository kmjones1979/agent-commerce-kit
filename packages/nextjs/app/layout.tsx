import type { Metadata } from "next";
import { Sora, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Agent Commerce Kit",
  description: "Onchain AI agent · stablecoin payments · Ampersend policy · 1Claw vault",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sora.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <a
            href="#site-main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to main content
          </a>
          <div id="site-main" className="min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
