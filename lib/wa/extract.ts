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

export interface RawChannel {
  id: string;
  name: string;
  /** Subscriber total WhatsApp reports, including the ones it will not name. */
  subscriberCount: number;
  /** True when the subscriber list was refused, as opposed to being empty. */
  listingFailed: boolean;
  subscribers: RawParticipant[];
}

export interface RawContact extends RawParticipant {
  /** True when the number is in the linked phone's address book, not merely known to WhatsApp. */
  saved: boolean;
  isBusiness: boolean;
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

/**
 * Attach a `@lid` -> phone resolver to the page. Broadcast recipients and
 * channel subscribers both arrive as privacy identifiers, and both need the
 * same walk through the contact store to come back out as a real number.
 */
async function installJidResolver(client: Client): Promise<void> {
  await client.pupPage!.evaluate(() => {
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

    (window as any).__focasResolveJid = (jid: string) => {
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
  });
}

/** Read broadcast lists and resolve their `@lid` recipients to phone numbers. */
export async function readBroadcasts(client: Client): Promise<RawBroadcast[]> {
  await installJidResolver(client);
  return client.pupPage!.evaluate(() => {
    const Store = (window as any).require('WAWebCollections');
    const resolveJid = (window as any).__focasResolveJid;

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
 * Read WhatsApp Channels and whoever WhatsApp is willing to name in them.
 *
 * Channels are far more closed than groups: only a channel's own admins can
 * pull a subscriber list at all, and the identifiers that come back resolve to
 * a phone number only for people the linked phone already has as a contact. A
 * channel that refuses to list is flagged with `listingFailed` so the sync can
 * report it rather than store it as empty.
 */
export async function readChannels(client: Client): Promise<RawChannel[]> {
  await installJidResolver(client);
  return client.pupPage!.evaluate(async () => {
    const Store = (window as any).require('WAWebCollections');
    const resolveJid = (window as any).__focasResolveJid;

    const load = (name: string) => {
      try {
        return (window as any).require(name);
      } catch {
        return null;
      }
    };
    const subscribersJob = load('WAWebMexFetchNewsletterSubscribersJob');
    const gating = load('WAWebNewsletterGatingUtils');

    // Channel titles arrive either as a plain string or as a metadata mixin
    // carrying the text alongside its last-update timestamp.
    const titleOf = (v: any): string =>
      typeof v === 'string' ? v : v?.text || v?.nameElementValue || '';

    // Channels have their own collection, but builds that predate it surface
    // them only as 'newsletter' chats. Take both and de-duplicate by id.
    const byId = new Map<string, any>();
    for (const c of Store.WAWebNewsletterCollection?.getModelsArray?.() ?? []) {
      byId.set(c.id._serialized, c);
    }
    for (const c of Store.Chat.getModelsArray()) {
      if (c.id.server === 'newsletter' && !byId.has(c.id._serialized)) {
        byId.set(c.id._serialized, c);
      }
    }

    const out = [];
    for (const ch of byId.values()) {
      const id = ch.id._serialized;
      const meta = ch.newsletterMetadata ?? ch.channelMetadata ?? {};

      let raw: any[] = [];
      let listingFailed = false;
      try {
        const limit = gating?.getMaxSubscriberNumber?.() ?? 5000;
        const response = await subscribersJob.mexFetchNewsletterSubscribers(id, limit);
        raw = response?.subscribers ?? [];
      } catch {
        // Not an admin of this channel, or WhatsApp declined the request.
        listingFailed = true;
      }

      const subscribers = raw
        .map((s: any) => {
          const jid =
            typeof s === 'string'
              ? s
              : s?.id?._serialized || s?.contactId?._serialized || s?.wid?._serialized || '';
          if (!jid) return null;
          // Channel roles are OWNER / ADMIN / SUBSCRIBER / GUEST.
          const role = String(s?.role ?? '').toUpperCase();
          return {
            ...resolveJid(jid),
            isAdmin: role === 'ADMIN',
            isSuperAdmin: role === 'OWNER',
          };
        })
        .filter(Boolean);

      out.push({
        id,
        name: titleOf(ch.name) || titleOf(meta.name) || titleOf(ch.formattedTitle) || ch.id.user,
        subscriberCount: meta.subscribersCount ?? subscribers.length,
        listingFailed,
        subscribers,
      });
    }
    return out;
  });
}

/**
 * Read the linked account's own contact list.
 *
 * This is the one source that does not depend on group or channel membership:
 * the address book already holds real phone numbers, so nothing has to be
 * resolved from an `@lid`. `savedOnly` keeps it to numbers actually saved on
 * the phone; widen it to take everyone WhatsApp knows the account has dealt
 * with, which is far larger and far noisier.
 */
export async function readContacts(
  client: Client,
  opts: { savedOnly?: boolean } = {},
): Promise<RawContact[]> {
  const savedOnly = opts.savedOnly !== false;

  return client.pupPage!.evaluate((savedOnlyArg: boolean) => {
    const Store = (window as any).require('WAWebCollections');

    const toNumber = (value: any): string | null => {
      if (!value) return null;
      const s =
        typeof value === 'string'
          ? value
          : value.user
            ? value.user
            : String(value._serialized || value);
      const digits = s.split('@')[0].replace(/\D/g, '');
      return /^\d{8,}$/.test(digits) ? digits : null;
    };

    const out = [];
    for (const c of Store.Contact.getModelsArray()) {
      // Contacts are keyed either by number ('c.us') or by privacy id ('lid').
      // Anything else in this collection is a group, channel or broadcast.
      const server = c.id?.server;
      if (server !== 'c.us' && server !== 'lid') continue;
      if (c.isMe) continue;

      const saved = !!c.isMyContact;
      if (savedOnlyArg && !saved) continue;

      // The address book is the whole point of this source, so a contact whose
      // number cannot be read is not worth storing as an @lid placeholder.
      const phone = toNumber(c.phoneNumber) ?? (server === 'c.us' ? toNumber(c.id.user) : null);
      if (!phone) continue;

      out.push({
        // Only a 'lid'-server id is a privacy identifier; a 'c.us' id is the number itself.
        lid: server === 'lid' ? c.id._serialized : null,
        phone,
        name: c.name || c.pushname || c.verifiedName || c.formattedName || '',
        isAdmin: false,
        isSuperAdmin: false,
        saved,
        isBusiness: !!c.isBusiness,
      });
    }
    return out;
  }, savedOnly);
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
 * Channels whose subscribers were actually listed. One that refused is left out
 * entirely, like an unreadable group: persisting it would overwrite its last
 * good member count with zero on every run by a non-admin.
 */
export function buildChannelSources(channels: RawChannel[]): ExtractedSource[] {
  return channels.filter((c) => !c.listingFailed).map((c) => ({
    type: 'channel' as const,
    sourceId: c.id,
    label: c.name,
    subgroups: [{ id: c.id, name: c.name, memberCount: c.subscribers.length }],
    members: c.subscribers.map((s) => ({
      ...s,
      groups: [c.name],
      role: s.isSuperAdmin ? ('Super Admin' as Role) : s.isAdmin ? ('Admin' as Role) : ('Member' as Role),
    })),
  }));
}

/** Channels whose subscriber list WhatsApp refused, for reporting on the sync. */
export function unlistedChannels(channels: RawChannel[]): RawChannel[] {
  return channels.filter((c) => c.listingFailed);
}

/** The address book, as a single source so it can be filtered and exported like any other. */
export function buildContactSources(contacts: RawContact[]): ExtractedSource[] {
  if (contacts.length === 0) return [];
  const label = 'Saved contacts';
  return [
    {
      type: 'contact' as const,
      sourceId: 'contacts',
      label,
      subgroups: [{ id: 'contacts', name: label, memberCount: contacts.length }],
      members: contacts.map((c) => ({
        lid: c.lid,
        phone: c.phone,
        name: c.name,
        isAdmin: false,
        isSuperAdmin: false,
        groups: [label],
        role: 'Member' as Role,
      })),
    },
  ];
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
