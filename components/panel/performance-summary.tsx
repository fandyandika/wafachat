import { LedgerMetric, LedgerMetricGrid, LedgerSection } from "@/components/panel/dashboard/ledger";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaPill } from "@/components/ui/metric-card";
import { formatDuration, formatNumberId, formatPercentId, formatPointsId, formatRupiah } from "@/lib/format";
import type { PerformanceReport } from "@/lib/performance-report";

function DeltaDetail({ value, format }: { value: number; format?: (value: number) => string }) {
  return <DeltaPill value={value} format={format} />;
}

export function PerformanceSummary({ summary }: { summary: PerformanceReport["summary"] }) {
  return (
    <LedgerSection title="Kinerja periode" description="Snapshot laporan terpilih">
      <LedgerMetricGrid>
        <LedgerMetric label="Leads" value={formatNumberId(summary.leads)} detail={<DeltaDetail value={summary.deltaLeads} />} />
        <LedgerMetric label="Closing" value={formatNumberId(summary.closings)} detail={<DeltaDetail value={summary.deltaClosings} />} tone="positive" />
        <LedgerMetric label="Conversion Rate" value={formatPercentId(summary.cr)} detail={<DeltaDetail value={summary.deltaCr} format={formatPointsId} />} tone="positive" />
        <LedgerMetric label="Omzet" value={formatRupiah(summary.revenue)} detail={<DeltaDetail value={summary.deltaRevenue} format={formatRupiah} />} />
        <LedgerMetric label="Respons CS" value={formatDuration(summary.responseMedianMs)} detail="Median balasan pertama" />
        <LedgerMetric label="Diskon" value={formatRupiah(summary.discount)} detail="Total diskon periode" />
        <LedgerMetric label="COD" value={formatNumberId(summary.cod)} detail="Closing COD" />
        <LedgerMetric label="Transfer" value={formatNumberId(summary.transfer)} detail="Closing transfer" />
        <LedgerMetric label="Rasio pembayaran" value={<span className="text-base">COD {formatPercentId(summary.codPct)} · Transfer {formatPercentId(summary.transferPct)}</span>} detail="Komposisi closing" />
        <LedgerMetric label="Terkirim" value={formatNumberId(summary.delivered)} detail="Status pengiriman" />
        <LedgerMetric label="Dibatalkan" value={formatNumberId(summary.cancelled)} detail="Order dibatalkan" tone="negative" />
      </LedgerMetricGrid>
    </LedgerSection>
  );
}

export function PerformanceSummarySkeleton() {
  return (
    <section aria-label="Menyiapkan ringkasan laporan" className="overflow-hidden rounded-xl border border-ledger-rule bg-card">
      <div className="border-b border-ledger-rule px-5 py-4"><Skeleton className="h-5 w-36" /></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} data-summary-skeleton-cell className="min-h-28 border-b border-r border-ledger-rule p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}
