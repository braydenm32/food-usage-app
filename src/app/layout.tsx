import type { Metadata, Viewport } from "next";
import { Figtree, Young_Serif } from "next/font/google";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });
const youngSerif = Young_Serif({ variable: "--font-young-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "Larder", template: "%s · Larder" },
  description: "Know what's in your kitchen, what to eat first, and what to cook with it.",
  applicationName: "Larder",
  appleWebApp: { capable: true, title: "Larder", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#121815" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${figtree.variable} ${youngSerif.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Providers>
          <AppErrorBoundary>
            <AppShell>{children}</AppShell>
          </AppErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
