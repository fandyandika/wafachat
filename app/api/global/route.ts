import { NextRequest, NextResponse } from 'next/server';

const N8N_URL = process.env.N8N_STATE_MANAGER_URL!;

export async function GET() {
  try {
    const res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_global' }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json({ globalEnabled: data.globalEnabled !== false });
  } catch {
    return NextResponse.json({ globalEnabled: true });
  }
}

export async function POST(req: NextRequest) {
  const { enabled } = await req.json();
  try {
    await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_global', enabled }),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
