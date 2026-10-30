import type { Metadata } from "next";

export const metadata: Metadata = { title: "Your larder" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
