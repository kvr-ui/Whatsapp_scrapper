import { findAllLeads } from '@/lib/repo';
import {
  batch,
  csvFilename,
  toFullCsv,
  toWatiCsv,
  watiPartFilename,
  watiZipFilename,
} from '@/lib/csv';
import { zipFiles } from '@/lib/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Batch sizes the UI offers; anything else falls back to a single file. */
const ALLOWED_PER_FILE = [100, 250, 500];

/**
 * GET /api/export?format=wati|full[&perFile=100|250|500][&sourceId=&type=&role=&search=&resolved=&newWithinDays=]
 *
 * The filter parameters are identical to /api/leads, so whatever the table is
 * showing is exactly what gets exported.
 *
 * `perFile` splits a WATI export into fixed-size batches — WATI campaigns are
 * uploaded in capped chunks — and returns them as a single ZIP. Without it, or
 * when the whole result already fits in one batch, the response is a plain CSV.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const format = p.get('format') === 'full' ? 'full' : 'wati';

  const requested = Number(p.get('perFile'));
  const perFile = ALLOWED_PER_FILE.includes(requested) ? requested : 0;

  const leads = await findAllLeads({
    search: p.get('search') ?? undefined,
    sourceId: p.get('sourceId') ?? undefined,
    type: p.get('type') ?? undefined,
    role: p.get('role') ?? undefined,
    // The WATI export can only address real numbers, so it never includes
    // leads whose number stayed an @lid identifier.
    resolved: format === 'wati' ? 'resolved' : (p.get('resolved') ?? undefined),
    newWithinDays: p.get('newWithinDays') ? Number(p.get('newWithinDays')) : undefined,
  });

  const watiLeads = leads.filter((l) => l.phone);

  if (format === 'wati' && perFile > 0 && watiLeads.length > perFile) {
    const groups = batch(watiLeads, perFile);
    const zip = await zipFiles(
      groups.map((g, i) => ({
        name: watiPartFilename(i + 1, groups.length),
        body: toWatiCsv(g),
      })),
    );

    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${watiZipFilename(perFile)}"`,
        'Cache-Control': 'no-store',
        'X-Row-Count': String(watiLeads.length),
        'X-File-Count': String(groups.length),
      },
    });
  }

  const csv = format === 'wati' ? toWatiCsv(leads) : toFullCsv(leads);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(format)}"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(format === 'wati' ? watiLeads.length : leads.length),
      'X-File-Count': '1',
    },
  });
}
