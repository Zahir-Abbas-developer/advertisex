import { Skeleton } from "@/components/ui/Skeleton";

/** The standard page-loading shape: a header, a row of tiles, a main panel. */
export function PageSkeleton({ tiles = 3, label = "Loading" }: { tiles?: number; label?: string }) {
  return (
    <div className="space-y-8" aria-busy="true" aria-label={label}>
      <Skeleton className="h-24 rounded-card border-0 bg-transparent" />
      {tiles > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: tiles }).map((_, index) => (
            <Skeleton key={index} className="h-[132px] rounded-card" />
          ))}
        </div>
      )}
      <Skeleton className="h-[360px] rounded-card" />
    </div>
  );
}
