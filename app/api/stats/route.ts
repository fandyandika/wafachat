import { NextResponse } from 'next/server';

const N8N_URL = process.env.N8N_STATE_MANAGER_URL!;

export async function GET() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_stats', date: today }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json({
      orders: data.orders ?? 0,
      closings: data.closings ?? 0,
      handovers: data.handovers ?? 0,
      closed_today: data.closed_today ?? 0,
      date: today,
    });
  } catch {
    return NextResponse.json({ orders: 0, closings: 0, handovers: 0, closed_today: 0, date: today });
  }
}
