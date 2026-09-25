"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Secondary line under the label; replaced by `error` when one is present. */
  hint?: string;
  error?: string;
}

/**
 * The labelled checkbox the forms have been hand-rolling inline. One
 * component, so the hit target (the whole label), the focus ring and the
 * hint/error placement stay identical everywhere a yes/no question appears.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <label htmlFor={inputId} className={cn("flex items-start gap-2.5 text-[13px] text-ink/80", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-surface text-brand focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <span>
        {label}
        {error ? (
          <span id={`${inputId}-error`} className="mt-0.5 block text-[12px] text-danger">
            {error}
          </span>
        ) : hint ? (
          <span id={`${inputId}-hint`} className="mt-0.5 block text-ink/45">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
});
