"use client";

// MapShell - generic layout chassis for map-first pages.
//
// Encodes 3 invariants that are easy to get wrong by hand :
//   1. Lock to viewport-minus-header with overflow-hidden so the page never
//      scrolls when the map should be the whole UX.
//   2. Use `100svh` (small viewport height) instead of `100vh` so the mobile
//      browser URL bar never clips the bottom of the layout.
//   3. Map fills the available space via flex-1 + min-h-0. The `min-h-0` is
//      not optional - without it, the flex child refuses to shrink and the
//      layout overflows by exactly the height of the map's internal content.
//
// Composition :
//   - On desktop (md+) : sidebar on the left at a fixed width, map on the right.
//   - On mobile (<md) : map full-bleed; the same sidebar content is reachable
//     via a floating "Liste" CTA that opens it in a bottom Sheet.
//   - If `sidebar` is omitted, the shell is a pure full-bleed map - no
//     sidebar on desktop, no mobile sheet trigger.
//
// Requires shadcn/ui Sheet (`~/components/ui/sheet`) and `cn` from
// `~/lib/utils`. Both are present in any T3 project bootstrapped by
// hypervibe; if you use this template outside that context, run
// `npx shadcn@latest add sheet` first.

import { useState, type ReactNode } from "react";
import { List } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

export interface MapShellProps {
  /** The map element - typically `<MapLoader markers={…} height="100%" />`. */
  map: ReactNode;
  /** Secondary panel (list / filters / search / timeline…). When omitted, the
   *  shell renders the map full-bleed with no sidebar and no mobile sheet. */
  sidebar?: ReactNode;
  /** Mobile CTA label that opens the sidebar in a bottom Sheet. Default "Liste". */
  sidebarTriggerLabel?: string;
  /** Mobile sheet accessibility title. Default "Liste". */
  sidebarTitle?: string;
  /** Mobile sheet accessibility description (sr-only). */
  sidebarDescription?: string;
  /** CSS value for the global header height. Used to compute viewport-minus-header.
   *  Default "4rem" - matches hypervibe's standard `SiteHeader`. */
  headerOffset?: string;
  /** Sidebar width on desktop, in pixels. Default 420. */
  sidebarWidth?: number;
  /** Extra className for the outer wrapper. */
  className?: string;
}

export function MapShell({
  map,
  sidebar,
  sidebarTriggerLabel = "Liste",
  sidebarTitle = "Liste",
  sidebarDescription = "Choisis un élément dans la liste.",
  headerOffset = "4rem",
  sidebarWidth = 420,
  className,
}: MapShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasSidebar = sidebar !== undefined && sidebar !== null;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden md:flex-row",
        className,
      )}
      style={{ height: `calc(100svh - ${headerOffset})` }}
    >
      {hasSidebar && (
        <aside
          className="hidden h-full flex-col overflow-hidden border-r border-border bg-card/30 md:flex"
          style={{ width: `${sidebarWidth}px`, maxWidth: `${sidebarWidth}px` }}
        >
          {sidebar}
        </aside>
      )}

      <div className="relative flex-1 min-h-0">
        {map}

        {hasSidebar && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <button
                    type="button"
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-105 cursor-pointer"
                  >
                    <List size={18} />
                    {sidebarTriggerLabel}
                  </button>
                }
              />
              <SheetContent
                side="bottom"
                className="h-[85svh] rounded-t-xl border-border bg-card p-0 md:hidden"
              >
                <SheetTitle className="sr-only">{sidebarTitle}</SheetTitle>
                <SheetDescription className="sr-only">
                  {sidebarDescription}
                </SheetDescription>
                <div className="flex h-full flex-col overflow-hidden">
                  {sidebar}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}
      </div>
    </div>
  );
}
