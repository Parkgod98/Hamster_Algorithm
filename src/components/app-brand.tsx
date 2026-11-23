import Image from "next/image";

export function AppMark() {
  return <Image className="app-mark" src="/icon-192.png" alt="" width={36} height={36} unoptimized />;
}

export function AppBrand() {
  return <span className="app-brand"><AppMark /><strong>햄쮸터</strong></span>;
}
