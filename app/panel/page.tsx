'use client';

import { useEffect, useState, useCallback } from 'react';

interface Conversation {
  phone: string;
  status: 'active' | 'handover' | 'closed';
  customerName: string;
  productName: string;
  csName: string;
  updatedAt: string;
  note: string;
}

interface Stats {
  orders: number;
  closings: number;
  handovers: number;
  closed_today: number;
  date: string;
}

export default function PanelPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<Stats>({ orders: 0, closings: 0, handovers: 0, closed_today: 0, date: '' });
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [convRes, statsRes, globalRes] = await Promise.all([
        fetch('/api/conversations'),
        fetch('/api/stats'),
        fetch('/api/global'),
      ]);
      const convData = await convRes.json();
      const statsData = await statsRes.json();
      const globalData = await globalRes.json();
      setConversations(convData.conversations || []);
      setStats(statsData);
      setGlobalEnabled(globalData.globalEnabled !== false);
      setLastUpdated(new Date().toLocaleTimeString('id-ID'));
    } catch {
      // keep previous state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await fetch('/api/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    fetchAll();
  };

  const setStatus = async (phone: string, status: string) => {
    setActionLoading(phone + ':' + status);
    await fetch('/api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, status }),
    });
    await fetchAll();
    setActionLoading(null);
  };

  const active = conversations.filter(c => c.status === 'active');
  const handover = conversations.filter(c => c.status === 'handover');
  const crAI = stats.orders > 0 ? Math.round((stats.closings / stats.orders) * 100) : 0;
  const handoverRate = stats.orders > 0 ? Math.round((stats.handovers / stats.orders) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans">
      {/* Header */}
      <div className="border-b border-[#27272a] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">CS Panel</h1>
          <p className="text-xs text-[#71717a] mt-0.5">pustakaislam.net · WhatsApp Automation</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#52525b]">Update: {lastUpdated || '—'}</span>
          {/* Global AI Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#a1a1aa]">AI Global</span>
            <button
              onClick={toggleGlobal}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                globalEnabled ? 'bg-[#22c55e]' : 'bg-[#3f3f46]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  globalEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-xs font-medium ${globalEnabled ? 'text-[#22c55e]' : 'text-[#71717a]'}`}>
              {globalEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Pesanan Hari Ini" value={stats.orders} color="blue" />
          <StatCard label="Closing AI" value={stats.closings} color="green" />
          <StatCard label="CR AI" value={`${crAI}%`} color="green" />
          <StatCard label="Handover" value={stats.handovers} color="yellow" />
          <StatCard label="Handover Rate" value={`${handoverRate}%`} color="yellow" />
          <StatCard label="Chat Aktif" value={active.length} color="blue" />
          <StatCard label="Selesai" value={stats.closed_today} color="gray" />
        </div>

        {/* Handover Section */}
        {handover.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-[#f59e0b] mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
              Butuh Perhatian CS ({handover.length})
            </h2>
            <div className="rounded-lg border border-[#3d2e00] bg-[#1c160a] overflow-hidden">
              <ConversationTable
                rows={handover}
                actionLoading={actionLoading}
                onResumeAI={(phone) => setStatus(phone, 'active')}
                onSelesai={(phone) => setStatus(phone, 'closed')}
              />
            </div>
          </div>
        )}

        {/* Active Section */}
        <div>
          <h2 className="text-sm font-medium text-[#a1a1aa] mb-3 flex items-center gap-2">
            Chat Aktif ({active.length})
          </h2>
          {loading ? (
            <div className="rounded-lg border border-[#27272a] bg-[#111113] p-8 text-center text-sm text-[#52525b]">
              Memuat...
            </div>
          ) : active.length === 0 ? (
            <div className="rounded-lg border border-[#27272a] bg-[#111113] p-8 text-center text-sm text-[#52525b]">
              Tidak ada chat aktif saat ini.
            </div>
          ) : (
            <div className="rounded-lg border border-[#27272a] bg-[#111113] overflow-hidden">
              <ConversationTable
                rows={active}
                actionLoading={actionLoading}
                onResumeAI={(phone) => setStatus(phone, 'active')}
                onSelesai={(phone) => setStatus(phone, 'closed')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: 'blue' | 'green' | 'yellow' | 'gray' }) {
  const valueColors = {
    blue: 'text-[#60a5fa]',
    green: 'text-[#22c55e]',
    yellow: 'text-[#f59e0b]',
    gray: 'text-[#a1a1aa]',
  };
  return (
    <div className="bg-[#111113] border border-[#27272a] rounded-lg p-4">
      <p className="text-xs text-[#71717a] leading-tight mb-2">{label}</p>
      <p className={`text-2xl font-bold ${valueColors[color]}`}>{value}</p>
    </div>
  );
}

function ConversationTable({
  rows,
  actionLoading,
  onResumeAI,
  onSelesai,
}: {
  rows: Conversation[];
  actionLoading: string | null;
  onResumeAI: (phone: string) => void;
  onSelesai: (phone: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#27272a] text-xs text-[#52525b] uppercase tracking-wide">
          <th className="text-left px-4 py-3 font-medium">Nama / Nomor</th>
          <th className="text-left px-4 py-3 font-medium">Produk</th>
          <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Catatan</th>
          <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Update</th>
          <th className="text-right px-4 py-3 font-medium">Aksi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => (
          <tr
            key={c.phone}
            className={`border-b border-[#1f1f22] last:border-0 transition-colors ${
              c.status === 'handover' ? 'bg-[#1c1508]' : i % 2 === 0 ? '' : 'bg-[#0d0d0f]'
            }`}
          >
            <td className="px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-white text-sm">
                  {c.customerName || 'Tidak dikenal'}
                </span>
                <span className="text-xs text-[#52525b] font-mono">{c.phone}</span>
              </div>
            </td>
            <td className="px-4 py-3">
              <span className="text-[#a1a1aa] text-sm">{c.productName || '—'}</span>
            </td>
            <td className="px-4 py-3 hidden md:table-cell max-w-[200px]">
              <span className="text-[#71717a] text-xs truncate block">{c.note || '—'}</span>
            </td>
            <td className="px-4 py-3 hidden lg:table-cell">
              <span className="text-[#52525b] text-xs">{formatTime(c.updatedAt)}</span>
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-2">
                <a
                  href={`https://wa.me/${c.phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1.5 rounded bg-[#1a2e1a] text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 transition-colors"
                >
                  WA
                </a>
                {c.status === 'handover' && (
                  <button
                    onClick={() => onResumeAI(c.phone)}
                    disabled={actionLoading === c.phone + ':active'}
                    className="text-xs px-2.5 py-1.5 rounded bg-[#1a1f2e] text-[#60a5fa] border border-[#60a5fa]/20 hover:bg-[#60a5fa]/20 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === c.phone + ':active' ? '...' : 'Resume AI'}
                  </button>
                )}
                <button
                  onClick={() => onSelesai(c.phone)}
                  disabled={actionLoading === c.phone + ':closed'}
                  className="text-xs px-2.5 py-1.5 rounded bg-[#1f1a1a] text-[#f87171] border border-[#f87171]/20 hover:bg-[#f87171]/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === c.phone + ':closed' ? '...' : 'Selesai'}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
