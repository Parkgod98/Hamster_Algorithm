import type { Metadata, Viewport } from "next";
import { ClientEnhancements } from "@/components/client-enhancements";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";
import "./enhancements.css";
import "./push.css";

export const metadata: Metadata = {
  title: "햄쮸터",
  description: "알고리즘 스터디 자동 인증",
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
  themeColor: "#242421",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><PwaRegister /><ClientEnhancements />{children}</body></html>;
}
