import { card } from "@/lib/ui";

// Skeleton shown while the dashboard's section queries resolve. No loading.tsx
// convention existed in the repo, so this is a simple shimmer matching the
// design doc's loading frame: a title line + a 2-col grid of card placeholders.
const shimmer = "animate-pulse rounded-lg bg-foreground/10";

function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <div className={`${shimmer} h-3.5 w-2/5`} />
      <div className={`${shimmer} h-8 w-24`} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${shimmer} h-12 w-full`} />
      ))}
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-5 px-6 py-6 md:px-10">
      <div className="flex flex-col gap-2">
        <div className={`${shimmer} h-7 w-48`} />
        <div className={`${shimmer} h-3.5 w-2/3 max-w-xs`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <CardSkeleton rows={1} />
        </div>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
