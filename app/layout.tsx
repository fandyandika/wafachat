import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CS AI Panel',
  description: 'PustakaIslam CS Control Panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="bg-[#09090b] text-[#e4e4e7] min-h-screen antialiased">{children}</body>
    </html>
  );
}
