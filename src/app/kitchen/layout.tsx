import type { Metadata } from "next";

export const metadata: Metadata = { title: "Your kitchen" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
