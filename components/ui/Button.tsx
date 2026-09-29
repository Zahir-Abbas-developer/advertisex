import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-on-brand border border-brand hover:bg-brand-hover hover:border-brand-hover active:bg-brand disabled:opacity-50 disabled:hover:bg-brand",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-brand/30 active:bg-surface-2 disabled:text-ink/40",
  ghost:
    "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink disabled:text-ink-muted",
  danger:
    "bg-danger-tint text-danger border border-danger/25 hover:bg-danger hover:text-on-brand hover:border-danger disabled:opacity-50",
  dark: "bg-brand-strong text-on-brand border border-brand-strong hover:bg-brand hover:border-brand disabled:opacity-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

/** Base classes shared with link-styled-as-button call sites. */
export const buttonClasses = (
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) =>
  cn(
    "inline-flex items-center justify-center rounded-pill font-medium transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && "w-full", className))}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
