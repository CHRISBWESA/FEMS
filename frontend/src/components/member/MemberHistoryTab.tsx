import { useEffect, useState } from 'react';
import axios from 'axios';

const LABELS: Record<string, string> = {
  registered: 'Registered',
  status_changed: 'Status changed',
  department_joined: 'Joined department',
  department_transferred: 'Transferred department',
  department_removed: 'Removed from department',
};

function describe(e: any): string {
  switch (e.eventType) {
    case 'status_changed':
      return `${e.fromStatus ?? '—'} → ${e.toStatus ?? '—'}`;
    case 'department_joined':
    case 'department_removed':
      return e.department?.name || 'Unknown department';
    case 'department_transferred':
      return `${e.department?.name || 'Unknown'} → ${e.relatedDepartment?.name || 'Unknown'}`;
    default:
      return e.toStatus ? `as ${e.toStatus}` : '';
  }
}

export default function MemberHistoryTab({ memberId }: { memberId: string }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`/members/${memberId}/history`, { withCredentials: true })
      .then((res) => setEvents(res.data))
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view membership history."
        : 'Could not load membership history.'));
  }, [memberId]);

  if (error) return <p className="py-6 text-sm text-ink-muted">{error}</p>;
  if (!events) return <div className="flex justify-center py-10"><span className="spinner" /></div>;
  if (events.length === 0) return <p className="py-6 text-sm text-ink-muted">No history recorded yet.</p>;

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Membership history</h2>
      <ol className="relative space-y-5 border-l border-hairline pl-6">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-white" />
            <p className="text-sm font-medium text-ink">
              {LABELS[e.eventType] || e.eventType}
              <span className="ml-2 font-normal capitalize text-ink-muted">{describe(e)}</span>
            </p>
            <p className="text-xs text-ink-subtle">
              {new Date(e.occurredAt).toLocaleString()} · {e.recordedBy ? `by ${e.recordedBy.name || 'a user'}` : 'system'}
            </p>
            {e.reason && <p className="mt-1 text-sm text-ink-muted">“{e.reason}”</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
