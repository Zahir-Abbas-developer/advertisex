"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a dialog while it's open, and hands it back to
 * whatever opened it when it closes (WCAG 2.4.3 / 2.1.2). Focus moves to
 * `initial` if given, else the first focusable element, else the panel.
 */
export function useFocusTrap(active: boolean, container: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const panel = container.current;
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

    // After paint, so autoFocus and child effects win if they set focus themselves.
    const frame = requestAnimationFrame(() => {
      if (panel.contains(document.activeElement)) return;
      (initial?.current ?? items()[0] ?? panel).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      // Back to where the person was — if it's still on the page.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active, container, initial]);
}
