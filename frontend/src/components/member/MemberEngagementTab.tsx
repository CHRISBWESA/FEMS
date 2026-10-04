import { useEffect, useState } from 'react';
import axios from 'axios';
import { PageLoader } from '../ui';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-canvas p-4 ring-1 ring-inset ring-hairline">
      <p className="text-xs uppercase tracking-wider text-ink-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

export default function MemberEngagementTab({ memberId }: { memberId: string }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    axios.get(`/members/${memberId}/engagement?days=${days}`, { withCredentials: true })
      .then((res) => { setData(res.data); setError(''); })
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view engagement for this member."
        : 'Could not load engagement.'));
  }, [memberId, days]);

  if (error) return <p className="py-6 text-sm text-ink-muted">{error}</p>;
  if (!data) return <PageLoader rows={2} />;

  const a = data.attendance;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Engagement</h2>
        <select className="select w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`Activities attended (${data.window.days}d)`} value={a.activitiesAttendedInWindow} />
        <Stat label="Activities attended (all time)" value={a.activitiesAttended} />
        <Stat label="Last attended" value={a.lastAttendedAt ? new Date(a.lastAttendedAt).toLocaleDateString() : '—'} />
      </div>
      <p className="-mt-3 text-xs text-ink-subtle">
        {a.scope === 'department' ? "Counts your department's activities only. " : ''}
        Only attendance recorded against this member is counted; attendance captured by name only (for example through the public
        attendance link) cannot be attributed to a member.
      </p>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">Departments</h3>
        {data.departments.length === 0 ? (
          <p className="text-sm text-ink-muted">Not in any department.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {data.departments.map((d: any) => (
              <li key={d.departmentId} className="flex justify-between py-2 text-sm">
                <span className="text-ink">{d.name || d.departmentId}</span>
                <span className="text-ink-subtle">since {new Date(d.joinedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.leadership.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">Current leadership</h3>
          <ul className="divide-y divide-hairline">
            {data.leadership.map((l: any, i: number) => (
              <li key={i} className="flex justify-between py-2 text-sm">
                <span className="text-ink capitalize">{l.role?.replace(/_/g, ' ')} · {l.name || l.departmentId}</span>
                <span className="text-ink-subtle">since {new Date(l.since).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.groups && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">Groups</h3>
          {data.groups.length === 0 ? (
            <p className="text-sm text-ink-muted">Not in any group.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.groups.map((g: any) => (
                <span key={g.groupId} className="rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary">{g.name}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {data.serviceInterests && data.serviceInterests.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">Service interests</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.serviceInterests.map((t: string) => (
              <span key={t} className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink">{t}</span>
            ))}
          </div>
        </section>
      )}

      {data.youth && (data.youth.guardianOfCount > 0 || data.youth.isYouthParticipant) && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">Youth &amp; children involvement</h3>
          <p className="text-sm text-ink-muted">
            {data.youth.guardianOfCount > 0 && `Guardian of ${data.youth.guardianOfCount} participant(s). `}
            {data.youth.isYouthParticipant && 'Also registered as a youth participant.'}
          </p>
        </section>
      )}
    </div>
  );
}
