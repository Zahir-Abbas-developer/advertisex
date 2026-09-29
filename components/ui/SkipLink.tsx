/**
 * The first thing a keyboard reaches on every page: straight past the
 * navigation to the content (WCAG 2.4.1). Invisible until focused.
 */
export function SkipLink({ target = "main" }: { target?: string }) {
  return (
    <a
      href={`#${target}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg"
    >
      Skip to content
    </a>
  );
}
