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
 *   Name,CountryCode,Phone,AllowCampaign,AllowSMS,Attribute 1,Attribute 2
 *   WATI Test,852,64318721,TRUE,TRUE,value 1,value 2
 *
 * Note `CountryCode` and `Phone` are separate: the dialling code must NOT be
 * repeated inside Phone. Any column after AllowSMS is imported as a custom
 * attribute, which is how Source/Community/Groups/Role become filterable
 * inside WATI.
 *
 * `Name` is left blank when the lead has no WhatsApp display name — WATI shows
 * the number itself in that case. It is deliberately NOT filled with the phone
 * number, which would make the Name column useless for personalising
 * campaigns.
 *
 * Leads without a resolvable phone number are omitted — WATI cannot message an
 * `@lid` identifier. The export route reports how many were skipped.
 */
export function toWatiCsv(leads: Lead[]): string {
  const headers = [
    'Name',
    'CountryCode',
    'Phone',
    'AllowCampaign',
    'AllowSMS',
    'Source',
    'Community',
    'Groups',
    'Role',
  ];

  const rows = leads
    .filter((l) => l.phone)
    .map((l) => {
      const primary = pickPrimarySource(l);
      return [
        l.name?.trim() ?? '',
        countryCodeOf(l.phone) ?? '',
        nationalNumberOf(l.phone),
        'TRUE',
        'TRUE',
        primary?.type ?? '',
        primary?.sourceLabel ?? '',
        primary ? primary.groups.join(' | ') : '',
        primary?.role ?? 'Member',
      ];
    });

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

/** The membership a campaign should be attributed to: most groups, then newest. */
function pickPrimarySource(lead: Lead) {
  return [...lead.sources].sort(
    (a, b) =>
      b.groups.length - a.groups.length ||
      new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  )[0];
}

function isoDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}

/** `Content-Disposition` filename, e.g. wati-campaign-2026-08-26.csv */
export function csvFilename(kind: 'wati' | 'full'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return kind === 'wati'
    ? `wati-campaign-${stamp}.csv`
    : `whatsapp-leads-full-${stamp}.csv`;
}
