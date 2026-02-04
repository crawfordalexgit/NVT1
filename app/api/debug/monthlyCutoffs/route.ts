import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: false, error: 'debug endpoint disabled' }, { status: 410 });
}
