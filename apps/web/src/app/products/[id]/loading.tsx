import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="mx-auto flex h-10 w-full max-w-[1200px] items-center gap-6 px-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3.5 w-16" />
          ))}
        </div>
      </div>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-12" />
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="surface p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <SkeletonRows rows={5} />
          </div>
          <div className="surface p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <SkeletonRows rows={4} />
          </div>
        </div>
      </main>
    </>
  );
}
