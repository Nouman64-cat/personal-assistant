import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import AppHeader from "@/components/AppHeader";
import { EngagementAlarmProvider } from "@/components/EngagementAlarmProvider";
import MobileNav from "@/components/MobileNav";
import Sidebar from "@/components/Sidebar";
import { AppStateProvider } from "@/lib/appState";
import { ChatStateProvider } from "@/lib/chatState";

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
          <ChatStateProvider>
            <EngagementAlarmProvider>
              <div className="flex h-full flex-col md:flex-row">
                <Sidebar />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <AppHeader />
                  <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
                    {children}
                  </main>
                </div>
                <MobileNav />
              </div>
            </EngagementAlarmProvider>
          </ChatStateProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
