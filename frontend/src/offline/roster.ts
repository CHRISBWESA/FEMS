import { idbAll, idbClear, idbDelete, idbGet, idbPut } from './idb';

// The member list a device needs to record attendance for ONE activity without a connection. The server
// returns it already minimised (id, name, member code) and scoped to the account's fellowship.

export const ROSTER_TTL_MS = 24 * 60 * 60 * 1000;

export interface RosterMember { id: string; fullName: string; memberCode: string }
export interface Roster {
  key: string;
  userId: string;
  activityId: string;
  activity: { id: string; title: string; date: string };
  members: RosterMember[];
  recorded: string[]; // member ids the server already has for this activity
  truncated: boolean;
  savedAt: number;
}

const keyOf = (userId: string, activityId: string) => `${userId}|${activityId}`;

export async function saveRoster(userId: string, activityId: string, data: Omit<Roster, 'key' | 'userId' | 'activityId' | 'savedAt'>, now = Date.now()): Promise<Roster> {
  const roster: Roster = { ...data, key: keyOf(userId, activityId), userId, activityId, savedAt: now };
  await idbPut('rosters', roster);
  return roster;
}

/** The cached roster, or null when there is none for this account or it has expired (expired ones are deleted). */
export async function loadRoster(userId: string, activityId: string, now = Date.now()): Promise<Roster | null> {
  const r = await idbGet<Roster>('rosters', keyOf(userId, activityId));
  if (!r || r.userId !== userId) return null;
  if (now - r.savedAt > ROSTER_TTL_MS) { await idbDelete('rosters', r.key); return null; }
  return r;
}

export async function markRecorded(userId: string, activityId: string, memberIds: string[]): Promise<void> {
  const r = await idbGet<Roster>('rosters', keyOf(userId, activityId));
  if (!r || r.userId !== userId) return;
  await idbPut('rosters', { ...r, recorded: Array.from(new Set([...r.recorded, ...memberIds])) });
}

export async function hasAnyRoster(): Promise<boolean> {
  return (await idbAll('rosters')).length > 0;
}

export async function wipeRosters(): Promise<void> {
  await idbClear('rosters');
}
