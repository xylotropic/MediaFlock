"use client";
import { Button } from "./base/buttons/button";
import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight } from "lucide-react";
import { Chip } from "./base/badges/chip";
import { PlatformMark, socialPlatforms } from "./platform-mark";
export const platformNames: Record<string, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
};
export const platformMarks: Record<string, string> = {
  youtube: "▶",
  facebook: "f",
  instagram: "◎",
  tiktok: "♪",
  linkedin: "in",
  x: "𝕏",
};
export function FlockMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.64}
      viewBox="0 0 370 235"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M120 87C191 4 276 73 362 0C329 98 281 110 219 85C175 68 150 65 120 87Z" />
      <path d="M63 144C130 54 218 164 304 110C279 182 232 178 183 158C119 132 98 121 63 144Z" />
      <path d="M3 207C83 110 156 211 226 192C187 254 152 225 105 206C62 189 33 184 3 207Z" />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <FlockMark size={32} />
      <span>MediaFlock</span>
    </span>
  );
}
export function Platform({
  platform,
  small = false,
}: {
  platform: string;
  small?: boolean;
}) {
  return (
    <span
      className={"platform-icon " + (small ? "mini-icon" : "")}
      title={platformNames[platform]}
      aria-label={platformNames[platform]}
    >
      {socialPlatforms.find(
        (item) => item.name.toLowerCase() === platform.toLowerCase(),
      ) ? (
        <PlatformMark
          icon={
            socialPlatforms.find(
              (item) => item.name.toLowerCase() === platform.toLowerCase(),
            )!.icon
          }
        />
      ) : (
        platformMarks[platform] || "·"
      )}
    </span>
  );
}
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    needs_reconciliation: "Checking delivery",
    permission_missing: "Permission missing",
    submitting: "Submitting",
    processing: "Processing",
    queued: "Queued",
    scheduled: "Scheduled",
    published: "Published",
    failed: "Failed",
    cancelled: "Cancelled",
    approved: "Approved",
    rejected: "Rejected",
    revoked: "Revoked",
    pending: "Pending approval",
    connected: "Connected",
    disconnected: "Disconnected",
    unknown: "Unknown",
    missed: "Missed",
    ready: "Ready",
  };
  const color = ["published", "approved", "connected", "ready"].includes(value)
    ? "lime"
    : ["failed", "permission_missing", "rejected", "revoked"].includes(value)
      ? "rose"
      : ["needs_reconciliation", "pending", "missed", "unknown"].includes(value)
        ? "yellow"
        : ["queued", "scheduled", "submitting", "processing"].includes(value)
          ? "blue"
          : "neutral";
  return (
    <Chip color={color} variant="bold">
      {labels[value] || value}
    </Chip>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <FlockMark size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Header({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const controls = focusables();
        if (!controls.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === controls[0]) {
          e.preventDefault();
          controls.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
          e.preventDefault();
          controls[0].focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <Button
            leadingIcon={X}
            iconOnly
            variant="ghost"
            type="button"
            className="w-9"
            onClick={onClose}
            aria-label="Close dialog"
          ></Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
export function LocalTime({
  value,
  timezone = "America/New_York",
  dateOnly = false,
}: {
  value: string;
  timezone?: string;
  dateOnly?: boolean;
}) {
  if (!value) return <span className="muted">—</span>;
  return (
    <time dateTime={new Date(value).toISOString()}>
      {new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: dateOnly ? undefined : "short",
      }).format(new Date(value))}
    </time>
  );
}
export function num(value: number | null | undefined) {
  return value === null || value === undefined
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
        value,
      );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      trailingIcon={ArrowUpRight}
      variant="ghost"
      size="small"
      type="button"
      className=""
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="note error-note">
      {message}
    </div>
  );
}
