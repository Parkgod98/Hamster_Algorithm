import type { Metadata, Viewport } from "next";
import { ClientEnhancements } from "@/components/client-enhancements";
import { PwaRegister } from "@/components/pwa-register";
import { ViewSync } from "@/components/view-sync";
import "./globals.css";
import "./enhancements.css";
import "./push.css";
import "./theme.css";
import "./account.css";

export const metadata: Metadata = {
  title: "햄쮸터",
  description: "스터디의 매일 인증을 함께 기록하는 햄쮸터 달력",
  applicationName: "햄쮸터",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "햄쮸터",
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f5f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><PwaRegister /><ViewSync /><ClientEnhancements />{children}</body></html>;
}
