import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct } from "@/lib/products";
import { listJobs, type JobView } from "@/lib/library";
import { AppShell, PageHeader } from "@/components/AppShell";
import { JobProgress } from "@/components/JobProgress";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FilterPills } from "@/components/ui/Tabs";
import { formatDateTime } from "@/components/ui/format";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function matches(j: JobView, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === "active") return !TERMINAL.has(j.status);
  if (filter === "failed") return j.status === "failed";
  return j.status === filter;
}

function costOf(j: JobView): number | null {
  const v = j.cost?.usd_estimate;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export default async function JobsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const { status } = await searchParams;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  const all = await listJobs(id, 100);
  const jobsList = all.filter((j) => matches(j, status));
  const active = all.filter((j) => !TERMINAL.has(j.status)).length;
  const failed = all.filter((j) => j.status === "failed").length;
  const totalCost = all.reduce((sum, j) => sum + (costOf(j) ?? 0), 0);

  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <PageHeader
        title="Jobs"
        description="Everything the pipeline is doing for this product, newest first."
        action={totalCost > 0 ? <span className="text-xs text-muted">Estimated spend <span className="font-mono tabular-nums text-ink">${totalCost.toFixed(3)}</span></span> : undefined}
      />
      <FilterPills
        param="status"
        options={[
          { label: "All", value: null, count: all.length },
          { label: "Active", value: "active", count: active },
          { label: "Failed", value: "failed", count: failed },
        ]}
        className="mb-6"
      />

      {jobsList.length === 0 ? (
        <EmptyState title={status ? `No ${status} jobs.` : "No jobs yet. Jobs appear here when you sample a palette or generate clips."} />
      ) : (
        <Card>
          <ul className="divide-y divide-hairline">
            {jobsList.map((j) => {
              const cost = costOf(j);
              const live = !TERMINAL.has(j.status);
              return (
                <li key={j.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-[13px] font-medium text-ink">{j.type}</span>
                      <Pill status={j.status} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted tabular-nums">
                      {cost != null && (
                        <span title="Cost estimate">
                          <span className="font-mono text-ink">${cost.toFixed(3)}</span>
                        </span>
                      )}
                      {j.attempts > 1 && <span>attempt {j.attempts}</span>}
                      <span title={new Date(j.createdAt).toLocaleString()}>{formatDateTime(j.createdAt)}</span>
                      <span className="font-mono text-faint">{j.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="mt-3">
                    {live ? (
                      <JobProgress compact jobId={j.id} initial={{ status: j.status, progressPct: j.progressPct, currentStep: j.currentStep, attempts: j.attempts, error: j.error, result: j.result }} />
                    ) : (
                      <>
                        <ProgressBar value={j.status === "completed" ? 100 : j.progressPct} tone={j.status === "completed" ? "emerald" : j.status === "failed" ? "red" : "gray"} />
                        {j.status === "failed" && j.error?.message && (
                          <p className="mt-2 text-xs text-red-600">
                            {j.error.step && <span className="font-mono text-red-500">[{j.error.step}] </span>}
                            {j.error.message}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
