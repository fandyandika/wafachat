import { NextRequest, NextResponse } from 'next/server';

const N8N_URL = process.env.N8N_STATE_MANAGER_URL!;

export async function POST(req: NextRequest) {
  const { phone, status } = await req.json();
  if (!phone || !status) {
    return NextResponse.json({ ok: false, error: 'phone and status required' }, { status: 400 });
  }
  try {
    await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', phone, status }),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
