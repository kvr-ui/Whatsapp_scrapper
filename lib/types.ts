/** Where a lead was picked up from. */
export type SourceType = 'community' | 'broadcast' | 'group';

export type Role = 'Super Admin' | 'Admin' | 'Member';

/** One membership: this lead appearing in one community / broadcast list. */
export interface LeadSource {
  type: SourceType;
  /** Parent-group id for communities, chat id for broadcast lists. */
  sourceId: string;
  sourceLabel: string;
  /** Subgroup names the lead appears in (communities only). */
  groups: string[];
  role: Role;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * A lead is keyed by phone number when WhatsApp exposes one, and by the
 * privacy `@lid` identifier when it does not. `_id` is that key, so the same
 * person appearing in five subgroups stays one document.
 */
export interface Lead {
  _id: string;
  phone: string | null;
  lid: string | null;
  name: string;
  countryCode: string | null;
  sources: LeadSource[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** False once a sync no longer finds the lead in any of its sources. */
  active: boolean;
}

export interface Subgroup {
  id: string;
  name: string;
  memberCount: number;
}

/** A community or broadcast list, as last seen by a sync. */
export interface Source {
  _id: string;
  type: SourceType;
  label: string;
  subgroups: Subgroup[];
  memberCount: number;
  adminCount: number;
  /** Members whose phone number could not be resolved from the local contact store. */
  unresolvedCount: number;
  firstSeenAt: Date;
  lastSyncedAt: Date;
}

export type SyncStatus = 'queued' | 'running' | 'success' | 'failed';
export type SyncTrigger = 'cron' | 'manual' | 'cli';

export interface SyncRun {
  _id: string;
  status: SyncStatus;
  trigger: SyncTrigger;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  stats: {
    sources: number;
    leadsSeen: number;
    newLeads: number;
    updatedLeads: number;
    unresolved: number;
    /** Groups whose member list could not be read; skipped rather than emptied. */
    skippedGroups: number;
  };
  /** Human-readable progress, updated as the run proceeds. */
  step: string | null;
  error: string | null;
}

/** Singleton doc tracking the linked-device state for the QR pairing flow. */
export interface WaSessionState {
  _id: 'session';
  status: 'unlinked' | 'awaiting_scan' | 'linked' | 'error';
  /** Data-URL PNG of the current pairing QR, when status is awaiting_scan. */
  qrDataUrl: string | null;
  qrExpiresAt: Date | null;
  linkedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}
