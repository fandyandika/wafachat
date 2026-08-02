'use client';

import React from 'react';

import { OwnerHome } from '@/components/panel/dashboard/owner-home';
import { CsHome } from '@/components/panel/dashboard/cs-home';
import { useMe } from '@/components/panel/use-me';

export default function DashboardPage() {
  const me = useMe();
  if (!me) return <div className="h-72 animate-pulse rounded-xl border border-ledger-rule bg-card" aria-label="Memuat dashboard" />;
  return me.role === 'cs' ? <CsHome me={me} /> : <OwnerHome />;
}
