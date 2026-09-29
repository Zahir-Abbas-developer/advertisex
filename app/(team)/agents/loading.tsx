import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading AI employees">
      <Skeleton className="h-16 w-72 rounded-card" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
