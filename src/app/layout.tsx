import type { Metadata } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";
export const metadata:Metadata={title:"햄쮸터",description:"알고리즘 스터디 자동 인증",applicationName:"햄쮸터",icons:{icon:"/icon.svg",apple:"/icon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><body><PwaRegister/>{children}</body></html>}
