"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BookOpen, Home, Plus, ShoppingBasket, Warehouse, Settings } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";

const TABS = [
  { href: "/", label: "Today", Icon: Home },
  { href: "/pantry", label: "Larder", Icon: Warehouse },
  { href: "/add", label: "Add", Icon: Plus, primary: true },
  { href: "/recipes", label: "Recipes", Icon: BookOpen },
  { href: "/list", label: "List", Icon: ShoppingBasket },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  // Navigation reads the pathname, so it sits in its own Suspense boundaries and the page can prerender.
  return (
    <div className="lg:flex lg:min-h-dvh">
      <Suspense fallback={null}>
        <DesktopNav />
      </Suspense>
      <main className="pb-tabbar mx-auto w-full max-w-3xl lg:px-10">{children}</main>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}

function useNavState() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const listCount = useLarder((s) => s.shoppingList.filter((l) => !l.checked).length);
  // Onboarding is a full-screen flow without navigation.
  return { pathname, hidden: pathname.startsWith("/welcome"), listCount: hydrated ? listCount : 0 };
}

function DesktopNav() {
  const { pathname, hidden, listCount } = useNavState();
  if (hidden) return null;
  return (
      <nav aria-label="Main" className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:px-4 lg:py-8">
        <Link href="/" className="mb-8 px-3 font-display text-3xl text-ink">
          Larder
        </Link>
        <ul className="flex flex-col gap-1">
          {TABS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "flex h-11 items-center gap-3 rounded-full px-3 text-[15px] font-medium transition-colors",
                    active ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <Icon size={20} aria-hidden />
                  {label === "Add" ? "Add food" : label}
                  {href === "/list" && listCount > 0 && (
                    <span className="ml-auto rounded-full bg-surface-2 px-2 text-xs tabular-nums text-ink-2">{listCount}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          href="/settings"
          aria-current={isActive(pathname, "/settings") ? "page" : undefined}
          className={clsx(
            "mt-auto flex h-11 items-center gap-3 rounded-full px-3 text-[15px] font-medium transition-colors",
            isActive(pathname, "/settings") ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Settings size={20} aria-hidden />
          Settings
        </Link>
      </nav>

  );
}

function MobileNav() {
  const { pathname, hidden, listCount } = useNavState();
  if (hidden) return null;
  return (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {TABS.map(({ href, label, Icon, ...rest }) => {
            const active = isActive(pathname, href);
            const primary = "primary" in rest && rest.primary;
            return (
              <li key={href} className="flex flex-1 justify-center">
                {primary ? (
                  <Link
                    href={href}
                    aria-label="Add food"
                    aria-current={active ? "page" : undefined}
                    className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-ink shadow-card ring-4 ring-paper"
                  >
                    <Icon size={26} aria-hidden strokeWidth={2.5} />
                  </Link>
                ) : (
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                      active ? "text-primary" : "text-ink-3",
                    )}
                  >
                    <Icon size={22} aria-hidden strokeWidth={active ? 2.4 : 2} />
                    {label}
                    {href === "/list" && listCount > 0 && (
                      <span className="absolute right-[calc(50%-1.25rem)] top-2 min-w-4 rounded-full bg-today px-1 text-[10px] leading-4 text-white">
                        {listCount}
                      </span>
                    )}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
  );
}
