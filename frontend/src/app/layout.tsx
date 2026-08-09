import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
      <body className="min-h-full">
        <AppStateProvider>
          <div className="flex min-h-full">
            <Sidebar />
            <main className="min-w-0 flex-1 bg-zinc-50 dark:bg-zinc-950">{children}</main>
          </div>
        </AppStateProvider>
      </body>
    </html>
  );
}
