import { redirect } from 'next/navigation';

// CS AI dashboard di-disable sementara (belum ada AI; lihat docs/ROADMAP.md).
// Implementasi dipreservasi di components/panel/cs-ai-dashboard.tsx.
export default function Page() {
  redirect('/panel');
}
