'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Source } from '@/lib/types';

/** Filters write straight to the URL, so every view is linkable and shareable. */
export function LeadFilters({ sources }: { sources: Pick<Source, '_id' | 'label' | 'type'>[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('search') ?? '');

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page'); // any filter change resets to the first page
    startTransition(() => router.push(`/leads?${next}`));
  }

  const value = (k: string) => params.get(k) ?? '';
  const hasFilters = ['search', 'sourceId', 'type', 'role', 'resolved', 'newWithinDays']
    .some((k) => params.get(k));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="filter-bar">
        <div className="field">
          <label htmlFor="f-search">Search</label>
          <form onSubmit={(e) => { e.preventDefault(); apply({ search }); }}>
            <input
              id="f-search"
              type="search"
              placeholder="Name or number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => search !== value('search') && apply({ search })}
            />
          </form>
        </div>

        <div className="field">
          <label htmlFor="f-source">Source</label>
          <select id="f-source" value={value('sourceId')}
            onChange={(e) => apply({ sourceId: e.target.value })}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s._id} value={s._id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" value={value('type')} onChange={(e) => apply({ type: e.target.value })}>
            <option value="">All types</option>
            <option value="community">Community</option>
            <option value="group">Group</option>
            <option value="broadcast">Broadcast</option>
            <option value="channel">Channel</option>
            <option value="contact">Saved contacts</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-role">Role</label>
          <select id="f-role" value={value('role')} onChange={(e) => apply({ role: e.target.value })}>
            <option value="">All roles</option>
            <option value="Member">Member</option>
            <option value="Admin">Admin</option>
            <option value="Super Admin">Super Admin</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-resolved">Number</label>
          <select id="f-resolved" value={value('resolved')}
            onChange={(e) => apply({ resolved: e.target.value })}>
            <option value="">Any</option>
            <option value="resolved">Resolved only</option>
            <option value="unresolved">Unresolved only</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-new">Added</label>
          <select id="f-new" value={value('newWithinDays')}
            onChange={(e) => apply({ newWithinDays: e.target.value })}>
            <option value="">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {(hasFilters || pending) && (
        <div className="row small faint">
          {pending && <span>Updating…</span>}
          {hasFilters && (
            <button className="btn btn-sm" data-variant="ghost"
              onClick={() => startTransition(() => router.push('/leads'))}>
              ✕ Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
