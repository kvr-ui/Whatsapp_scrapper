import type { Filter } from 'mongodb';
import { collections } from './mongo';
import type { Lead, Source, SyncRun } from './types';

export interface LeadQuery {
  search?: string;
  sourceId?: string;
  type?: string;
  role?: string;
  /** 'resolved' = has a phone number, 'unresolved' = @lid only. */
  resolved?: string;
  /** Only leads first seen within the last N days. */
  newWithinDays?: number;
  page?: number;
  pageSize?: number;
}

export function buildLeadFilter(q: LeadQuery): Filter<Lead> {
  const filter: Filter<Lead> = {};

  if (q.search?.trim()) {
    const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { _id: rx }];
  }
  // Source, type and role must hold for the same membership — matched
  // separately, "Admin in communities" would also catch a group admin who is a
  // plain member of some community.
  const membership: Record<string, string> = {};
  if (q.sourceId) membership.sourceId = q.sourceId;
  if (q.type) membership.type = q.type;
  if (q.role) membership.role = q.role;
  if (Object.keys(membership).length) filter.sources = { $elemMatch: membership };
  if (q.resolved === 'resolved') filter.phone = { $ne: null };
  if (q.resolved === 'unresolved') filter.phone = null;
  if (q.newWithinDays && q.newWithinDays > 0) {
    filter.firstSeenAt = { $gte: daysAgo(q.newWithinDays) };
  }
  return filter;
}

export async function findLeads(q: LeadQuery) {
  const { leads } = await collections();
  const filter = buildLeadFilter(q);
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

  const [items, total] = await Promise.all([
    leads
      .find(filter)
      // Newest first; within a batch, reachable leads outrank @lid-only ones
      // (descending puts non-null phones before null in MongoDB's sort order).
      .sort({ firstSeenAt: -1, phone: -1, name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    leads.countDocuments(filter),
  ]);

  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 };
}

/** Unpaginated, for CSV export. */
export async function findAllLeads(q: LeadQuery): Promise<Lead[]> {
  const { leads } = await collections();
  return leads.find(buildLeadFilter(q)).sort({ name: 1, _id: 1 }).toArray();
}

export async function listSources(): Promise<Source[]> {
  const { sources } = await collections();
  return sources.find({}).sort({ memberCount: -1 }).toArray();
}

export async function listSyncRuns(limit = 20): Promise<SyncRun[]> {
  const { syncRuns } = await collections();
  return syncRuns.find({}).sort({ queuedAt: -1 }).limit(limit).toArray();
}

export async function getDashboardStats() {
  const { leads, sources, syncRuns } = await collections();

  const [totalLeads, withPhone, newThisWeek, newThisMonth, admins, sourceCount, lastRun] =
    await Promise.all([
      leads.countDocuments({}),
      leads.countDocuments({ phone: { $ne: null } }),
      leads.countDocuments({ firstSeenAt: { $gte: daysAgo(7) } }),
      leads.countDocuments({ firstSeenAt: { $gte: daysAgo(30) } }),
      leads.countDocuments({ 'sources.role': { $in: ['Admin', 'Super Admin'] } }),
      sources.countDocuments({}),
      syncRuns.find({}).sort({ queuedAt: -1 }).limit(1).next(),
    ]);

  return {
    totalLeads,
    withPhone,
    unresolved: totalLeads - withPhone,
    newThisWeek,
    newThisMonth,
    admins,
    sourceCount,
    lastRun,
  };
}

/** Leads added per ISO week for the last `weeks` weeks, oldest first. */
export async function getWeeklyGrowth(weeks = 12) {
  const { leads } = await collections();
  const since = daysAgo(weeks * 7);

  const rows = await leads
    .aggregate<{ _id: string; count: number }>([
      { $match: { firstSeenAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%G-W%V', date: '$firstSeenAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  // Weeks with no new leads are absent from the aggregation. Fill them in so
  // the chart always spans the full window and gaps read as real zeros.
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  return lastIsoWeeks(weeks).map((week) => ({ week, count: counts.get(week) ?? 0 }));
}

/** The last `n` ISO week labels, oldest first, matching MongoDB's `%G-W%V`. */
function lastIsoWeeks(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(isoWeekLabel(new Date(Date.now() - i * 7 * 86_400_000)));
  }
  return out;
}

function isoWeekLabel(d: Date): string {
  // Shift to the Thursday of this week: ISO weeks belong to the year holding
  // their Thursday, which is what %G encodes.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
