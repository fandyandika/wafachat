import { NextResponse } from 'next/server';

const N8N_URL = process.env.N8N_STATE_MANAGER_URL!;

export async function GET() {
  try {
    const res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_all' }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json({ conversations: data.conversations ?? [] });
  } catch {
    return NextResponse.json({ conversations: [] });
  }
}
