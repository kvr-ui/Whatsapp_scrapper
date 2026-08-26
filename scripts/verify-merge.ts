/**
 * Verifies the lead-merge rules against the live database using a namespaced
 * throwaway source (`test:src:alpha`) that it creates and deletes again. Your
 * real leads are never touched.
 *
 *   npm run verify-merge
 *
 * Regression test for the three merge behaviours that were wrong:
 *  1. a source that reads back empty must not delete existing memberships
 *  2. a lead re-keyed from @lid to a phone number keeps its firstSeenAt
 *     and leaves no duplicate behind
 *  3. a member genuinely leaving a group IS pruned
 */
import './env';
import { collections } from '../lib/mongo';
import { persistSources } from '../lib/wa/store';
import type { ExtractedSource } from '../lib/wa/extract';

const T = 'test:src:alpha';
const member = (phone: string | null, lid: string | null, name = '') => ({
  phone, lid, name, isAdmin: false, isSuperAdmin: false,
  groups: ['Alpha Group'], role: 'Member' as const,
});
const src = (members: ReturnType<typeof member>[]): ExtractedSource[] => ([{
  type: 'community', sourceId: T, label: 'Alpha',
  subgroups: [{ id: T, name: 'Alpha Group', memberCount: members.length }],
  members,
}]);

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${name}${cond ? '' : `  → ${detail}`}`);
  if (!cond) failures++;
};

(async () => {
  const { leads, sources } = await collections();
  await leads.deleteMany({ 'sources.sourceId': T });
  await sources.deleteMany({ _id: T });

  // ── Run 1: three members, one of them unresolved (@lid only)
  const day1 = new Date('2026-01-01T00:00:00Z');
  await persistSources(src([
    member('911111111111', 'a@lid', 'Alice'),
    member('912222222222', 'b@lid', 'Bob'),
    member(null, 'c@lid', 'Carol'),
  ]), day1);

  const afterRun1 = await leads.find({ 'sources.sourceId': T }).toArray();
  check('run 1 stores 3 leads', afterRun1.length === 3, `got ${afterRun1.length}`);
  check('unresolved lead is keyed by @lid',
    afterRun1.some((l) => l._id === 'c@lid' && l.phone === null));

  // ── Run 2: the source reads back EMPTY (simulating a failed extraction)
  const day2 = new Date('2026-02-01T00:00:00Z');
  await persistSources(src([]), day2);

  const afterEmpty = await leads.find({ 'sources.sourceId': T }).toArray();
  check('BUG 1 — empty read does NOT wipe memberships',
    afterEmpty.length === 3, `memberships dropped to ${afterEmpty.length}`);
  check('BUG 1 — no lead wrongly marked inactive',
    afterEmpty.every((l) => l.active), 'a lead was deactivated');

  // ── Run 3: Carol's number resolves; Bob has left the group
  const day3 = new Date('2026-03-01T00:00:00Z');
  await persistSources(src([
    member('911111111111', 'a@lid', 'Alice'),
    member('913333333333', 'c@lid', 'Carol'),
  ]), day3);

  const carolNew = await leads.findOne({ _id: '913333333333' });
  const carolOld = await leads.findOne({ _id: 'c@lid' });
  check('BUG 2 — resolved lead is re-keyed to its phone number', !!carolNew);
  check('BUG 2 — the @lid duplicate is removed', carolOld === null,
    'orphaned @lid document still present');
  check('BUG 2 — firstSeenAt survives the re-key',
    carolNew?.firstSeenAt.getTime() === day1.getTime(),
    `got ${carolNew?.firstSeenAt.toISOString()}, expected ${day1.toISOString()}`);

  const bob = await leads.findOne({ _id: '912222222222' });
  check('a member who genuinely left IS pruned',
    bob !== null && bob.sources.every((s) => s.sourceId !== T),
    'Bob still holds the membership');
  check('a lead left with no memberships is deactivated',
    bob?.active === false, `active=${bob?.active}`);

  const alice = await leads.findOne({ _id: '911111111111' });
  check('an unchanged lead keeps its original firstSeenAt',
    alice?.firstSeenAt.getTime() === day1.getTime());
  check('an unchanged lead keeps its membership firstSeenAt',
    alice?.sources.find((s) => s.sourceId === T)?.firstSeenAt.getTime() === day1.getTime());

  await leads.deleteMany({ 'sources.sourceId': T });
  await leads.deleteMany({ _id: { $in: ['912222222222', 'c@lid'] } });
  await sources.deleteMany({ _id: T });

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
