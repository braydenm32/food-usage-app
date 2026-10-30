"use client";

import clsx from "clsx";
import Link from "next/link";
import { X, Minus, Plus, Settings as SettingsIcon } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export { clsx as cx };

/* ---------- Buttons ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:pointer-events-none select-none";
// Disabled buttons stay solid and legible rather than washed out.
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:brightness-110 active:brightness-95 disabled:bg-surface-2 disabled:text-ink-3",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:text-ink-3",
  danger: "bg-spoiled text-on-status hover:brightness-110 disabled:bg-surface-2 disabled:text-ink-3",
};
/** Invisible hit area so small controls still get a 44px touch target. */
const HIT_44 = "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']";
const buttonSizes: Record<ButtonSize, string> = {
  sm: `h-9 px-3.5 text-sm ${HIT_44}`,
  md: "h-11 px-5 text-[15px]",
  lg: "h-14 px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)}
      {...props}
    />
  );
});

/** Class string for links styled as buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", block = false) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full");
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Page header ---------- */

/**
 * Page title row. `showSettings` adds a gear link to /settings after `actions`; it is hidden
 * at lg, where the side rail already links to Settings.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  showSettings,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  showSettings?: boolean;
}) {
  return (
    <header className="flex items-end justify-between gap-4 px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] lg:px-0 lg:pt-10">
      <div className="min-w-0">
        <h1 className="font-display text-[2rem] leading-tight text-ink lg:text-[2.5rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {(actions || showSettings) && (
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {showSettings && (
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <SettingsIcon size={22} aria-hidden />
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between gap-3 first:mt-0">
      <h2 className="font-display text-xl text-ink">{children}</h2>
      {action}
    </div>
  );
}

/* ---------- Surfaces ---------- */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...props}>
      {children}
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div aria-hidden className="mb-4 text-5xl">
        {emoji}
      </div>
      <p className="font-display text-xl text-ink">{title}</p>
      {body && <p className="mt-2 max-w-xs text-[15px] text-ink-2">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ---------- Chips and segmented control ---------- */

export function Chip({
  selected,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(
        "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        HIT_44,
        selected ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-2 hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("flex rounded-full bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
            HIT_44,
            value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form fields ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  label,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  label: string;
  suffix?: string;
}) {
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, round(value - step)))}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 after:absolute after:-inset-0.5 after:content-['']"
      >
        <Minus size={16} />
      </button>
      <span className="min-w-12 text-center text-sm font-semibold tabular-nums text-ink" aria-live="polite">
        {value}
        {suffix ? ` ${suffix}` : ""}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(round(value + step))}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 after:absolute after:-inset-0.5 after:content-['']"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-[15px] font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-sm text-ink-2">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          // 48×28 track; the after: element widens the touch target to 44px tall.
          "relative h-7 w-12 shrink-0 rounded-full transition-colors after:absolute after:-inset-2 after:content-['']",
          "disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "bg-primary" : "bg-ink-3",
        )}
      >
        <span
          aria-hidden
          className={clsx(
            // left-0 pins the knob; without it the absolute box sits at the centred static position.
            "absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/* ---------- Sheet (bottom sheet on mobile, centred dialog on desktop) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[1.75rem] bg-surface p-0 text-ink backdrop:bg-black/40 backdrop:animate-fade-in",
        "open:flex open:flex-col open:animate-sheet-up",
        "lg:m-auto lg:max-h-[85vh] lg:rounded-[1.75rem]",
        wide ? "lg:max-w-2xl" : "lg:max-w-lg",
      )}
    >
      {open && (
        <>
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <h2 id={titleId} className="font-display text-2xl leading-tight">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X size={20} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="border-t border-line px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">{footer}</div>
          )}
        </>
      )}
    </dialog>
  );
}
