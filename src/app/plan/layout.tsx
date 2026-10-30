import type { Metadata } from "next";

export const metadata: Metadata = { title: "Meal plan" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
