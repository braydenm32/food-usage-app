import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sync and share" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
