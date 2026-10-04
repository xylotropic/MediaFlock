"use client";
/* Adapted from BoardUI free Sidebar, MIT; see /licenses/boardui.txt.
 * Keeps its floating panel, selected navigation, and collapsible label design.
 * MediaFlock owns navigation, user identity, mobile state, and sign-out behavior.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, LogOut, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { cx } from "@/utils/cx";

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;
export interface DashboardNavItem {
  key: string;
  label: string;
  icon: IconComponent;
  href: string;
}
function Collapsible({
  collapsed,
  children,
  className,
}: {
  collapsed: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out",
        collapsed
          ? "max-w-0 opacity-0 blur-[3px]"
          : "max-w-full opacity-100 blur-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
function NavItem({
  item,
  selected,
  collapsed,
  onNavigate,
}: {
  item: DashboardNavItem;
  selected: boolean;
  collapsed: boolean;
  onNavigate: (key: string) => void;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onNavigate(item.key);
      }}
      aria-current={selected ? "page" : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      className={cx(
        "flex items-center justify-between overflow-hidden rounded-2lg p-2 transition-[width,background-color] duration-300 ease-in-out",
        collapsed ? "w-9" : "w-full",
        selected
          ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
          : "hover:bg-background-secondary-hover",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          className={cx(
            "size-5 shrink-0",
            selected ? "text-white" : "text-foreground-icon-secondary",
          )}
          aria-hidden
        />
        <Collapsible collapsed={collapsed}>
          <span
            className={cx(
              "text-body-medium whitespace-nowrap",
              selected ? "text-white" : "text-text-secondary",
            )}
          >
            {item.label}
          </span>
        </Collapsible>
      </span>
    </a>
  );
}
export function DashboardSidebar({
  collapsed,
  mobileOpen,
  selected,
  items,
  brand,
  name,
  initials,
  onCollapse,
  onClose,
  onNavigate,
  onSearch,
  onSignOut,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  selected: string;
  items: DashboardNavItem[];
  brand: ReactNode;
  name: string;
  initials: string;
  onCollapse: () => void;
  onClose: () => void;
  onNavigate: (key: string) => void;
  onSearch: () => void;
  onSignOut: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen || !window.matchMedia("(max-width: 900px)").matches) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const close = panel.current?.querySelector<HTMLButtonElement>(
      ".board-mobile-close",
    );
    close?.focus();
    return () => {
      previous?.focus();
    };
  }, [mobileOpen]);
  return (
    <aside
      ref={panel}
      onKeyDown={(event) => {
        if (!mobileOpen || !window.matchMedia("(max-width: 900px)").matches)
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),input:not(:disabled)",
          ) || [],
        ).filter(
          (el) =>
            el.getClientRects().length &&
            getComputedStyle(el).visibility !== "hidden",
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      data-boardui-sidebar
      className={cx(
        "sidebar board-sidebar flex shrink-0 flex-col justify-between overflow-hidden rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar transition-[width] duration-300 ease-in-out",
        collapsed ? "collapsed w-[60px] px-[11px] py-3" : "w-[260px] p-3",
        mobileOpen && "open",
      )}
      aria-label="Workspace navigation"
    >
      <div className="-m-2 flex min-h-0 w-[calc(100%+16px)] flex-col gap-3 overflow-y-auto p-2 [scrollbar-width:none]">
        <div
          className={cx(
            "board-sidebar-heading flex w-full transition-[gap] duration-300 ease-in-out",
            collapsed
              ? "flex-col-reverse items-start justify-center gap-2.5"
              : "flex-row items-center justify-between",
          )}
        >
          <Link
            href="/"
            aria-label="MediaFlock home"
            className="board-sidebar-brand min-w-0 text-text-primary"
          >
            {brand}
          </Link>
          <Button
            variant="ghost"
            iconOnly
            leadingIcon={collapsed ? PanelLeftOpen : PanelLeftClose}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onCollapse}
            className="board-collapse shrink-0 text-foreground-icon-secondary"
          />
          <Button
            variant="ghost"
            iconOnly
            leadingIcon={X}
            aria-label="Close navigation"
            onClick={onClose}
            className="board-mobile-close shrink-0"
          />
        </div>
        <div className="flex w-full flex-col gap-3">
          <Button
            variant="ghost"
            contentLayout="custom"
            onClick={onSearch}
            aria-label="Open command palette"
            title={collapsed ? "Search or jump to…" : undefined}
            className={cx(
              "board-sidebar-search flex items-center justify-between gap-2 rounded-full bg-background-tertiary-default p-2 text-text-secondary hover:bg-background-tertiary-hover/55",
              collapsed ? "w-9" : "w-full",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Search className="size-5 shrink-0" aria-hidden />
              <Collapsible collapsed={collapsed}>
                <span className="text-body-medium whitespace-nowrap">
                  Quick search
                </span>
              </Collapsible>
            </span>
            <Collapsible collapsed={collapsed}>
              <kbd className="text-caption-1-medium">⌘ K</kbd>
            </Collapsible>
          </Button>
          <nav
            aria-label="Main navigation"
            className={cx(
              "board-sidebar-nav flex w-full flex-col gap-1",
              !collapsed && "px-0.5",
            )}
          >
            {items.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                selected={item.key === selected}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
        </div>
      </div>
      <div
        className={cx(
          "board-sidebar-account mt-4 flex w-full shrink-0 items-center gap-2 rounded-2lg bg-background-tertiary-default",
          collapsed ? "flex-col py-2" : "p-2",
        )}
      >
        <Avatar size="lg" color="blue" initials={initials} aria-label={name} />
        <Collapsible collapsed={collapsed} className="grow">
          <span className="min-w-0 text-caption-1-medium text-text-primary">
            <span className="block truncate">{name}</span>
            <span className="block text-caption-2-regular text-text-secondary">
              Your workspace
            </span>
          </span>
        </Collapsible>
        <Button
          variant="ghost"
          size="small"
          iconOnly
          leadingIcon={LogOut}
          aria-label="Sign out"
          title="Sign out"
          onClick={onSignOut}
          className="shrink-0 text-foreground-icon-secondary"
        />
      </div>
    </aside>
  );
}
