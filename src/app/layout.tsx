import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "햄쮸터",
  description: "알고리즘 스터디 자동 인증",
  applicationName: "햄쮸터",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
