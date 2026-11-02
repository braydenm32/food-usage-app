"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BookOpen, CalendarDays, ChartColumn, Home, Plus, ShoppingBasket, Warehouse, Settings, WifiOff } from "lucide-react";
import { Suspense, useSyncExternalStore, type ReactNode } from "react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { RailSyncStatus } from "@/components/sync-indicator";
// Registers the install-prompt listener early, before the Today screen shows the card.
import "@/components/install-card";

const TABS = [
  { href: "/", label: "Today", Icon: Home },
  { href: "/pantry", label: "Larder", Icon: Warehouse },
  { href: "/add", label: "Add", Icon: Plus, primary: true },
  { href: "/recipes", label: "Recipes", Icon: BookOpen },
  { href: "/list", label: "List", Icon: ShoppingBasket },
] as const;

/** Extra desktop rail links: Plan (when the planner is on) and Insights, above Settings. */
const RAIL_EXTRAS = [
  { href: "/plan", label: "Plan", Icon: CalendarDays, planner: true },
  { href: "/insights", label: "Insights", Icon: ChartColumn, planner: false },
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
      <main className="pb-tabbar mx-auto w-full max-w-3xl lg:px-10 lg:has-[[data-wide]]:max-w-6xl">{children}</main>
      <OfflinePill />
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
  const planner = useLarder((s) => s.settings.mealPlannerEnabled);
  // Onboarding is a full-screen flow without navigation.
  return {
    pathname,
    hidden: pathname.startsWith("/welcome"),
    listCount: hydrated ? listCount : 0,
    planner: hydrated && planner,
  };
}

function DesktopNav() {
  const { pathname, hidden, listCount, planner } = useNavState();
  if (hidden) return null;
  const railLink = (active: boolean) =>
    clsx(
      "flex h-11 items-center gap-3 rounded-full px-3 text-[15px] font-medium transition-colors",
      active ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
    );
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
                <Link href={href} aria-current={active ? "page" : undefined} className={railLink(active)}>
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
        <ul className="mt-6 flex flex-col gap-1 border-t border-line pt-6">
          {RAIL_EXTRAS.filter((x) => !x.planner || planner).map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={railLink(active)}>
                  <Icon size={20} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex flex-col gap-1">
          <RailSyncStatus active={isActive(pathname, "/account") || isActive(pathname, "/join")} />
          <Link
            href="/settings"
            aria-current={isActive(pathname, "/settings") ? "page" : undefined}
            className={railLink(isActive(pathname, "/settings"))}
          >
            <Settings size={20} aria-hidden />
            Settings
          </Link>
        </div>
      </nav>

  );
}

function MobileNav() {
  const { pathname, hidden, listCount } = useNavState();
  if (hidden) return null;
  return (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.25)] lg:hidden"
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
                    className={clsx(
                      "group -mt-5 flex flex-col items-center gap-0.5 text-[11px] font-semibold",
                      active ? "text-primary" : "text-ink-2",
                    )}
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-ink shadow-card ring-4 ring-surface group-hover:brightness-110">
                      <Icon size={26} aria-hidden strokeWidth={2.5} />
                    </span>
                    <span aria-hidden>Add</span>
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
                      <span className="absolute right-[calc(50%-1.25rem)] top-2 min-w-4 rounded-full bg-today px-1 text-[10px] leading-4 text-on-status">
                        {listCount}
                        <span className="sr-only"> to buy</span>
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

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Small pill while the device is offline: the larder still works, AI and lookups don't. */
function OfflinePill() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-[calc(0.5rem+env(safe-area-inset-top))] z-50 flex justify-center">
      {!online && (
        <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper shadow-card">
          <WifiOff size={14} aria-hidden />
          Offline. Your larder still works
        </span>
      )}
    </div>
  );
}
