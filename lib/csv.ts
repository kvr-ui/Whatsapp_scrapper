import type { Lead } from './types';
import { countryCodeOf, nationalNumberOf, toE164 } from './format';

/**
 * RFC-4180 escaping. A leading =, +, - or @ is prefixed with a quoted tab so
 * Excel/Sheets treat pasted names as text rather than formulas.
 */
function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `\t${s}`;
  return /[",\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // Leading BOM keeps non-ASCII contact names (Tamil, emoji) intact in Excel.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * WATI bulk-contact / campaign upload format, matching WATI's own
 * `Contacts_Upload_Sample_Campaign.csv`:
 *
 *   Name,CountryCode,Phone,AllowCampaign,AllowSMS
 *   WATI Test,852,64318721,TRUE,TRUE
 *
 * `CountryCode` and `Phone` are separate: the dialling code must NOT be
 * repeated inside Phone.
 *
 * Most group members expose no WhatsApp display name, so `Name` falls back to
 * FALLBACK_NAME. It is deliberately never the phone number, which would make
 * the column useless for personalising campaigns.
 *
 * Leads without a resolvable phone number are omitted — WATI cannot message an
 * `@lid` identifier. The export route reports how many were skipped.
 */
const FALLBACK_NAME = 'Lead';

export function toWatiCsv(leads: Lead[]): string {
  const headers = ['Name', 'CountryCode', 'Phone', 'AllowCampaign', 'AllowSMS'];

  const rows = leads
    .filter((l) => l.phone)
    .map((l) => [
      l.name?.trim() || FALLBACK_NAME,
      countryCodeOf(l.phone) ?? '',
      nationalNumberOf(l.phone),
      'TRUE',
      'TRUE',
    ]);

  return toCsv(headers, rows);
}

/** Everything we hold on a lead, one row per lead, memberships flattened. */
export function toFullCsv(leads: Lead[]): string {
  const headers = [
    'Name',
    'Phone',
    'Phone (E.164)',
    'Country Code',
    'WhatsApp LID',
    'Number Resolved',
    'Role',
    'Sources',
    'Communities / Lists',
    'Groups',
    'Source Count',
    'Group Count',
    'First Seen',
    'Last Seen',
    'Active',
  ];

  const rows = leads.map((l) => {
    const groups = [...new Set(l.sources.flatMap((s) => s.groups))];
    return [
      l.name?.trim() ?? '',
      l.phone ?? '',
      toE164(l.phone),
      countryCodeOf(l.phone) ?? '',
      l.lid ?? '',
      l.phone ? 'Yes' : 'No',
      highestRole(l),
      [...new Set(l.sources.map((s) => s.type))].join(' | '),
      l.sources.map((s) => s.sourceLabel).join(' | '),
      groups.join(' | '),
      l.sources.length,
      groups.length,
      isoDate(l.firstSeenAt),
      isoDate(l.lastSeenAt),
      l.active ? 'Yes' : 'No',
    ];
  });

  return toCsv(headers, rows);
}

const ROLE_RANK = { 'Super Admin': 3, Admin: 2, Member: 1 } as const;

/** The most privileged role the lead holds across all of its memberships. */
export function highestRole(lead: Lead): string {
  return lead.sources.reduce(
    (best, s) => (ROLE_RANK[s.role] > ROLE_RANK[best] ? s.role : best),
    'Member' as keyof typeof ROLE_RANK,
  );
}

function isoDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}

/** Splits leads into fixed-size batches, e.g. 250 contacts per campaign file. */
export function batch<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function stampToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Name of one split part, e.g. wati-campaign-2026-08-26-part-02-of-05.csv */
export function watiPartFilename(index: number, total: number): string {
  const width = String(total).length;
  const n = String(index).padStart(width, '0');
  return `wati-campaign-${stampToday()}-part-${n}-of-${total}.csv`;
}

/** Name of the archive holding every split part. */
export function watiZipFilename(perFile: number): string {
  return `wati-campaign-${stampToday()}-${perFile}-per-file.zip`;
}

/** `Content-Disposition` filename, e.g. wati-campaign-2026-08-26.csv */
export function csvFilename(kind: 'wati' | 'full'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return kind === 'wati'
    ? `wati-campaign-${stamp}.csv`
    : `whatsapp-leads-full-${stamp}.csv`;
}
