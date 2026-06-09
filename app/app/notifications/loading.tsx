import { card } from "@/lib/ui";

// Skeleton shown while the notification feed query resolves. Mirrors the
// dashboard loading frame: a title line + a stack of row placeholders.
const shimmer = "animate-pulse rounded-lg bg-foreground/10";

function RowSkeleton() {
  return (
    <div className={`${card} flex items-start gap-3 px-4 py-3`}>
      <div className={`${shimmer} h-9 w-9 shrink-0 rounded-full`} />
      <div className="flex flex-1 flex-col gap-2">
        <div className={`${shimmer} h-4 w-2/5`} />
        <div className={`${shimmer} h-3.5 w-3/4`} />
        <div className={`${shimmer} h-3 w-20`} />
      </div>
    </div>
  );
}

export default function NotificationsLoading() {
  return (
    <div className="flex max-w-3xl flex-col gap-5 px-6 py-6 md:px-10">
      <div className="flex flex-col gap-2">
        <div className={`${shimmer} h-7 w-48`} />
        <div className={`${shimmer} h-3.5 w-40`} />
      </div>
      <div className="flex flex-col gap-2">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </div>
  );
}
