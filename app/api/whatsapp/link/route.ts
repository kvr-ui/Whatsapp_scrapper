import { NextResponse, after } from 'next/server';
import { startLinking } from '@/lib/wa/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Begin pairing. Returns as soon as a QR code has been written to MongoDB;
 * the Setup page polls /api/whatsapp/status to display and refresh it.
 */
export async function POST() {
  try {
    // Pairing outlives this response: the scan, then RemoteAuth's upload, happen
    // after the QR is returned. `after` keeps the function alive until then.
    return NextResponse.json(await startLinking({ keepAlive: (work) => after(() => work) }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ started: false, message }, { status: 500 });
  }
}
