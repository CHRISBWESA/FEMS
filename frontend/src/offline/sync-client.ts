import axios from 'axios';
import { SendFn, SyncOutcome, syncOutbox } from './outbox';
import { RosterMember, Roster, markRecorded, saveRoster } from './roster';

// The only place the offline layer talks to the API. Everything it sends is decided again by the server.

export const OUTBOX_EVENT = 'fems:outbox-changed';
export const notifyOutboxChanged = () => window.dispatchEvent(new Event(OUTBOX_EVENT));

export interface RosterResponse {
  activity: { id: string; title: string; date: string };
  members: RosterMember[];
  recorded: string[];
  truncated: boolean;
}

/** Downloads (and caches for this account) the member list needed to record attendance for one activity. */
export async function downloadRoster(userId: string, activityId: string): Promise<Roster> {
  const res = await axios.get<RosterResponse>(`/activities/${activityId}/attendance/roster`, { withCredentials: true });
  return saveRoster(userId, activityId, res.data);
}

const makeSender = (userId: string): SendFn => async (activityId, ops) => {
  const res = await axios.post(`/activities/${activityId}/attendance/sync`, { ops }, { withCredentials: true });
  const memberOf = new Map(ops.map((o) => [o.opId, o.memberId]));
  // Whatever the server now has is remembered in the cached roster, so the list stays right while offline.
  const done = (res.data.results as { opId: string; status: string }[]).filter((r) => r.status !== 'rejected').map((r) => memberOf.get(r.opId)!).filter(Boolean);
  if (done.length) await markRecorded(userId, activityId, done);
  return res.data;
};

export async function runSync(userId: string): Promise<SyncOutcome> {
  const out = await syncOutbox(userId, makeSender(userId));
  notifyOutboxChanged();
  return out;
}
