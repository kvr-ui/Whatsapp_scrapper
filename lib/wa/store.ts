import type { AnyBulkWriteOperation } from 'mongodb';
import { collections } from '../mongo';
import { normalisePhone, countryCodeOf } from '../format';
import type { Lead, LeadSource, Source } from '../types';
import type { ExtractedSource } from './extract';

export interface PersistResult {
  sources: number;
  leadsSeen: number;
  newLeads: number;
  updatedLeads: number;
  unresolved: number;
}

/**
 * Merge one sync's worth of extracted sources into the `leads` and `sources`
 * collections.
 *
 * Merging rules:
 *  - A lead is keyed by phone number, falling back to its `@lid` when WhatsApp
 *    does not expose one. `firstSeenAt` is never overwritten, so "new this
 *    week" stays meaningful across runs.
 *  - Each membership is stored separately, so a lead in three communities
 *    keeps three entries rather than three documents.
 *  - Memberships that disappear from a re-synced source are dropped; a lead
 *    left with no memberships is marked inactive rather than deleted.
 */
export async function persistSources(
  extracted: ExtractedSource[],
  now = new Date(),
): Promise<PersistResult> {
  const { leads, sources } = await collections();

  // key -> the lead as seen in this run, with one entry per source it appeared in
  const seen = new Map<string, { lead: Omit<Lead, 'sources'>; entries: LeadSource[] }>();

  for (const src of extracted) {
    for (const m of src.members) {
      const phone = normalisePhone(m.phone);
      const key = phone ?? m.lid;
      if (!key) continue;

      const entry: LeadSource = {
        type: src.type,
        sourceId: src.sourceId,
        sourceLabel: src.label,
        groups: [...new Set(m.groups)],
        role: m.role,
        firstSeenAt: now,
        lastSeenAt: now,
      };

      const existing = seen.get(key);
      if (existing) {
        existing.entries.push(entry);
        existing.lead.name ||= m.name;
        existing.lead.phone ??= phone;
      } else {
        seen.set(key, {
          lead: {
            _id: key,
            phone,
            lid: m.lid,
            name: m.name || '',
            countryCode: countryCodeOf(phone),
            firstSeenAt: now,
            lastSeenAt: now,
            active: true,
          },
          entries: [entry],
        });
      }
    }
  }

  const keys = [...seen.keys()];

  // A lead first stored under its @lid is re-keyed the moment WhatsApp resolves
  // a phone number for it. Look those old documents up too, so the re-keyed
  // lead inherits its history instead of appearing as brand new — and so the
  // superseded document does not linger as a duplicate.
  const supersededLids = [...seen.values()]
    .filter((v) => v.lead.phone && v.lead.lid && !seen.has(v.lead.lid))
    .map((v) => v.lead.lid!);

  const priorDocs = await leads
    .find({ _id: { $in: [...keys, ...supersededLids] } })
    .toArray();
  const prior = new Map(priorDocs.map((d) => [d._id, d]));

  // Sources that returned no members at all are not pruned: an extraction that
  // read nothing is indistinguishable from a group everyone left, and pruning
  // on that assumption would delete real memberships.
  const syncedSourceIds = new Set(
    extracted.filter((s) => s.members.length > 0).map((s) => s.sourceId),
  );
  const ops: AnyBulkWriteOperation<Lead>[] = [];
  const replacedIds: string[] = [];
  let newLeads = 0;
  let updatedLeads = 0;

  for (const [key, { lead, entries }] of seen) {
    let old = prior.get(key);

    if (!old && lead.phone && lead.lid) {
      const byLid = prior.get(lead.lid);
      if (byLid) {
        old = byLid;
        replacedIds.push(byLid._id);
      }
    }

    // Memberships in sources this run did not touch are carried over untouched.
    const untouched = (old?.sources ?? []).filter((s) => !syncedSourceIds.has(s.sourceId));

    const merged = entries.map((e) => {
      const before = old?.sources.find((s) => s.sourceId === e.sourceId);
      return before ? { ...e, firstSeenAt: before.firstSeenAt } : e;
    });

    const doc: Lead = {
      ...lead,
      name: lead.name || old?.name || '',
      phone: lead.phone ?? old?.phone ?? null,
      countryCode: countryCodeOf(lead.phone ?? old?.phone ?? null),
      firstSeenAt: old?.firstSeenAt ?? now,
      sources: [...untouched, ...merged],
      active: true,
    };

    ops.push({ replaceOne: { filter: { _id: key }, replacement: doc, upsert: true } });
    if (old) updatedLeads++;
    else newLeads++;
  }

  if (ops.length) await leads.bulkWrite(ops, { ordered: false });

  // Only after the re-keyed documents are safely written: remove the @lid-keyed
  // originals they replaced.
  if (replacedIds.length) await leads.deleteMany({ _id: { $in: replacedIds } });

  // Drop memberships for leads that vanished from a source we just re-read.
  if (syncedSourceIds.size) {
    await leads.updateMany(
      { _id: { $nin: keys }, 'sources.sourceId': { $in: [...syncedSourceIds] } },
      { $pull: { sources: { sourceId: { $in: [...syncedSourceIds] } } } },
    );
    await leads.updateMany({ sources: { $size: 0 } }, { $set: { active: false } });
  }

  // Upsert the source summaries shown on the dashboard.
  const sourceOps: AnyBulkWriteOperation<Source>[] = extracted.map((src) => {
    const unresolved = src.members.filter((m) => !normalisePhone(m.phone)).length;
    return {
      updateOne: {
        filter: { _id: src.sourceId },
        update: {
          $set: {
            type: src.type,
            label: src.label,
            subgroups: src.subgroups,
            memberCount: src.members.length,
            adminCount: src.members.filter((m) => m.role !== 'Member').length,
            unresolvedCount: unresolved,
            lastSyncedAt: now,
          },
          $setOnInsert: { firstSeenAt: now },
        },
        upsert: true,
      },
    };
  });
  if (sourceOps.length) await sources.bulkWrite(sourceOps, { ordered: false });

  return {
    sources: extracted.length,
    leadsSeen: seen.size,
    newLeads,
    updatedLeads,
    // Counted against what was persisted: a lead whose number was already known
    // from an earlier run is still reachable even if this run did not re-resolve it.
    unresolved: [...seen.entries()].filter(
      ([key, v]) => !(v.lead.phone ?? prior.get(key)?.phone),
    ).length,
  };
}
