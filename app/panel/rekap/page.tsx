import { redirect } from 'next/navigation';

// Rekap Pengiriman di-hide sementara — fokus panel = monitoring live performance CS;
// rekap pengiriman ditangani tools CS/admin terpisah.
// Implementasi dipreservasi di components/panel/rekap-dashboard.tsx.
export default function Page() {
  redirect('/panel');
}
