import type { Metadata } from "next";

export const metadata: Metadata = { title: "Recipe" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
