import { DailyReportDashboard } from '@/components/panel/daily-report-dashboard';

// Client component uses useSearchParams; the panel layout already wraps children in <Suspense>.
export default function Page() {
  return <DailyReportDashboard />;
}
