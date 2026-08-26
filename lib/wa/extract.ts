import type { Client } from 'whatsapp-web.js';
import type { Role, SourceType } from '../types';

export interface RawParticipant {
  lid: string | null;
  phone: string | null;
  name: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface RawGroup {
  id: string;
  name: string;
  parentId: string | null;
  participants: RawParticipant[];
  /** True when the participant list could not be read, as opposed to being empty. */
  metadataFailed: boolean;
}

export interface RawBroadcast {
  id: string;
  name: string;
  declaredCount: number;
  recipients: RawParticipant[];
}

export interface ExtractedSource {
  type: SourceType;
  sourceId: string;
  label: string;
  subgroups: { id: string; name: string; memberCount: number }[];
  members: (RawParticipant & { groups: string[]; role: Role })[];
}

/**
 * Wait for the chat store to populate. Chats stream in after `ready`, so a
 * sync that reads immediately sees zero groups.
 */
export async function waitForChatSync(client: Client, timeoutMs = 120_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count: number = await client.pupPage!.evaluate(
      () =>
        (window as any)
          .require('WAWebCollections')
          .Chat.getModelsArray()
          .filter((c: any) => c.id.server === 'g.us').length,
    );
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 0;
}

/**
 * Read every group and its participants straight out of the WhatsApp Web
 * store. Faster and far more reliable than `client.getChats()`, which times out
 * on accounts with many chats.
 */
export async function readGroups(client: Client): Promise<RawGroup[]> {
  return client.pupPage!.evaluate(async () => {
    const Store = (window as any).require('WAWebCollections');
    const GM = Store.WAWebGroupMetadataCollection;

    // Groups are identified by the 'g.us' server; the chat.isGroup flag no
    // longer exists in current WhatsApp Web builds.
    const chats = Store.Chat.getModelsArray().filter((c: any) => c.id.server === 'g.us');

    const out = [];
    for (const chat of chats) {
      let md = chat.groupMetadata;
      let parts = md?.participants?.getModelsArray?.() ?? [];
      let metadataFailed = false;

      // Metadata loads lazily, so a group can report zero members simply
      // because it has not been fetched yet. Force-load those, and record it
      // when the fetch fails — a failed read must not look like an empty group.
      if (parts.length === 0) {
        try {
          md = await GM.find(chat.id);
          parts = md?.participants?.getModelsArray?.() ?? [];
        } catch {
          metadataFailed = true;
        }
      }

      out.push({
        id: chat.id._serialized,
        name: chat.name || chat.formattedTitle || chat.id.user,
        parentId: md?.parentGroup?._serialized || null,
        metadataFailed,
        participants: parts.map((p: any) => {
          // Participant ids are '@lid' privacy identifiers; the real number
          // lives on the linked contact record.
          const contact = p.contact;
          let phone: string | null = null;
          const raw = contact?.phoneNumber;
          if (raw) {
            const u = raw.user ?? String(raw).split('@')[0];
            if (/^\d{8,}$/.test(u)) phone = u;
          }
          if (!phone && contact?.id?.server === 'c.us') phone = contact.id.user;
          if (!phone && p.id.server === 'c.us') phone = p.id.user;

          return {
            lid: p.id._serialized,
            phone,
            name: contact?.name || contact?.pushname || contact?.verifiedName || '',
            isAdmin: !!p.isAdmin,
            isSuperAdmin: !!p.isSuperAdmin,
          };
        }),
      });
    }
    return out;
  });
}

/** Read broadcast lists and resolve their `@lid` recipients to phone numbers. */
export async function readBroadcasts(client: Client): Promise<RawBroadcast[]> {
  return client.pupPage!.evaluate(() => {
    const Store = (window as any).require('WAWebCollections');
    const ApiContact = (() => {
      try {
        return (window as any).require('WAWebApiContact');
      } catch {
        return null;
      }
    })();

    const toNumber = (value: any): string | null => {
      if (!value) return null;
      const s =
        typeof value === 'string'
          ? value
          : value.user
            ? value.user
            : String(value._serialized || value);
      const digits = s.split('@')[0].replace(/\D/g, '');
      return digits || null;
    };

    const resolveJid = (jid: string) => {
      const contact = Store.Contact.get(jid);
      if (contact) {
        const n = toNumber(contact.phoneNumber);
        if (n) {
          return {
            lid: jid,
            phone: n,
            name: contact.name || contact.pushname || contact.verifiedName || '',
            isAdmin: false,
            isSuperAdmin: false,
          };
        }
      }
      if (ApiContact?.getPhoneNumber) {
        try {
          const n = toNumber(ApiContact.getPhoneNumber(contact ? contact.id : jid));
          if (n) {
            return { lid: jid, phone: n, name: contact?.name || '', isAdmin: false, isSuperAdmin: false };
          }
        } catch {
          /* unmapped */
        }
      }
      // Older lists predate @lid and already carry a plain phone jid.
      if (jid.endsWith('@c.us')) {
        return { lid: jid, phone: toNumber(jid), name: contact?.name || '', isAdmin: false, isSuperAdmin: false };
      }
      return { lid: jid, phone: null, name: contact?.name || '', isAdmin: false, isSuperAdmin: false };
    };

    return Store.Chat.getModelsArray()
      .filter((c: any) => c.id.server === 'broadcast' && c.id.user !== 'status')
      .map((c: any) => {
        const jids: string[] = c.broadcastMetadata?.audienceExpression?.userJids || [];
        return {
          id: c.id._serialized,
          name: c.name || c.formattedTitle || c.id.user,
          declaredCount: c.broadcastRecipientCount ?? jids.length,
          recipients: jids.map(resolveJid),
        };
      });
  });
}

/**
 * Rebuild communities from the `parentGroup` back-references on subgroups. The
 * community's announcement group is usually not in the chat list — you are a
 * member of the subgroups, not the parent — so it cannot be read directly.
 */
export function buildCommunities(groups: RawGroup[]): ExtractedSource[] {
  const byParent = new Map<string, RawGroup[]>();
  for (const g of usable(groups)) {
    if (!g.parentId) continue;
    if (!byParent.has(g.parentId)) byParent.set(g.parentId, []);
    byParent.get(g.parentId)!.push(g);
  }

  return [...byParent.entries()].map(([parentId, subgroups]) => ({
    type: 'community' as const,
    sourceId: parentId,
    // No readable community title is exposed, so name it after its largest subgroup.
    label: [...subgroups].sort((a, b) => b.participants.length - a.participants.length)[0].name,
    subgroups: subgroups.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g.participants.length,
    })),
    members: mergeMembers(subgroups),
  }));
}

/** Groups that belong to no community are kept as standalone sources. */
export function buildStandaloneGroups(groups: RawGroup[]): ExtractedSource[] {
  return usable(groups)
    .filter((g) => !g.parentId)
    .map((g) => ({
      type: 'group' as const,
      sourceId: g.id,
      label: g.name,
      subgroups: [{ id: g.id, name: g.name, memberCount: g.participants.length }],
      members: mergeMembers([g]),
    }));
}

export function buildBroadcastSources(lists: RawBroadcast[]): ExtractedSource[] {
  return lists.map((b) => ({
    type: 'broadcast' as const,
    sourceId: b.id,
    label: b.name,
    subgroups: [{ id: b.id, name: b.name, memberCount: b.recipients.length }],
    members: b.recipients.map((r) => ({ ...r, groups: [b.name], role: 'Member' as Role })),
  }));
}

/**
 * Groups whose participant list was actually read. A group that failed to load
 * would otherwise be persisted as "empty", which the store treats as everyone
 * having left — silently deleting real memberships.
 */
function usable(groups: RawGroup[]): RawGroup[] {
  return groups.filter((g) => !g.metadataFailed && g.participants.length > 0);
}

/** Groups that could not be read this run, for reporting on the sync. */
export function unreadableGroups(groups: RawGroup[]): RawGroup[] {
  return groups.filter((g) => g.metadataFailed);
}

/** Collapse a person appearing across several subgroups into one member record. */
function mergeMembers(groups: RawGroup[]) {
  const byKey = new Map<string, RawParticipant & { groups: string[]; role: Role }>();

  for (const g of groups) {
    for (const p of g.participants) {
      const key = p.phone || p.lid;
      if (!key) continue;

      const existing = byKey.get(key);
      if (existing) {
        existing.isAdmin ||= p.isAdmin;
        existing.isSuperAdmin ||= p.isSuperAdmin;
        existing.name ||= p.name;
        existing.phone ??= p.phone;
        if (!existing.groups.includes(g.name)) existing.groups.push(g.name);
      } else {
        byKey.set(key, { ...p, groups: [g.name], role: 'Member' });
      }
    }
  }

  for (const m of byKey.values()) {
    m.role = m.isSuperAdmin ? 'Super Admin' : m.isAdmin ? 'Admin' : 'Member';
  }
  return [...byKey.values()];
}
