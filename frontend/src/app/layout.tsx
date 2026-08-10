import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Sparkles } from "lucide-react";

import MobileNav from "@/components/MobileNav";
import Sidebar from "@/components/Sidebar";
import { AppStateProvider } from "@/lib/appState";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Assistant",
  description: "Parse engagements from raw text and find open time slots.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">
        <AppStateProvider>
          <div className="flex h-full flex-col md:flex-row">
            <Sidebar />
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
              <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Personal Assistant
              </span>
            </div>
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
              {children}
            </main>
            <MobileNav />
          </div>
        </AppStateProvider>
      </body>
    </html>
  );
}
