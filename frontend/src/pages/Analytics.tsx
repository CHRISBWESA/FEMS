import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Bar, Empty, Spinner, errMsg, isoDay, money } from '../components/finance/common';
import { CsvTable, downloadCsv } from '../lib/csv';

type Section = 'membership' | 'participation' | 'finance' | 'youth' | 'resources' | 'volunteers';
const LABEL: Record<Section, string> = { membership: 'Membership', participation: 'Participation', finance: 'Finance', youth: 'Youth', resources: 'Resources', volunteers: 'Volunteers' };

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h3>{children}</div>
);
const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="card"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-semibold text-slate-900">{value ?? '—'}</p>{hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</div>
);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
function Bars({ rows, label, value, fmt = (n: number) => String(n) }: { rows: any[]; label: (r: any) => string; value: (r: any) => number; fmt?: (n: number) => string }) {
  if (!rows?.length) return <p className="text-sm text-slate-500">Nothing to show for this period.</p>;
  const max = Math.max(...rows.map(value), 1);
  return <ul className="space-y-2">{rows.map((r, i) => <li key={i} className="flex items-center gap-3 text-sm"><span className="w-40 shrink-0 truncate text-slate-700">{label(r)}</span><Bar value={value(r)} max={max} /><span className="w-24 text-right font-medium text-slate-800">{fmt(value(r))}</span></li>)}</ul>;
}

export default function Analytics() {
  const [overview, setOverview] = useState<any>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | Section>('overview');
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(isoDay());
  const [departmentId, setDepartmentId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [applied, setApplied] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (periodId) p.set('periodId', periodId); else { p.set('from', from); p.set('to', to); }
    if (departmentId) p.set('departmentId', departmentId);
    return p.toString();
  }, [from, to, departmentId, periodId]);

  const load = () => { setOverview(null); setApplied(query); axios.get(`/analytics/overview?${query}`, { withCredentials: true }).then((r) => { setOverview(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load analytics'))); };
  useEffect(load, []);
  useEffect(() => {
    // Optional filter lookups; a role that may not read them simply doesn't get the filter.
    axios.get('/departments', { withCredentials: true }).then((r) => setDepartments(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    axios.get('/finance/periods', { withCredentials: true }).then((r) => setPeriods(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  if (error) return <div className="mx-auto max-w-7xl"><Empty text={error} /></div>;
  const available: Section[] = overview?.available ?? [];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-desc">Trends and summaries computed live from the fellowship's records. You only see what your role already allows.</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="mb-4 flex flex-wrap items-end gap-3">
        {!periodId && <>
          <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={to} min={from} max={isoDay()} onChange={(e) => setTo(e.target.value)} /></div>
        </>}
        {periods.length > 0 && (
          <div><label className="label">Financial period</label>
            <select className="select" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">Custom dates</option>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        )}
        {departments.length > 1 && overview?.scope !== 'department' && (
          <div><label className="label">Department</label>
            <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
        )}
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      {!overview ? <Spinner /> : (
        <>
          {overview.scope === 'department' && <p className="mb-3 text-sm text-slate-500">Showing your department only.</p>}
          <div className="tabs mb-4">
            <button className={`tab ${tab === 'overview' ? 'tab-active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
            {available.map((s) => <button key={s} className={`tab ${tab === s ? 'tab-active' : ''}`} onClick={() => setTab(s)}>{LABEL[s]}</button>)}
          </div>
          {tab === 'overview' ? <OverviewTab data={overview} go={setTab} /> : <SectionTab key={`${tab}|${applied}`} section={tab} query={applied} />}
        </>
      )}
    </div>
  );
}

function OverviewTab({ data, go }: { data: any; go: (s: Section) => void }) {
  const k = data.kpis;
  const groups: [Section, [string, any, string?][]][] = [
    ['membership', k.membership ? [['Members', k.membership.total], ['Active', k.membership.active], ['New in period', k.membership.newInPeriod]] : []],
    ['participation', k.participation ? [['Events', k.participation.events], ['Unique attendees', k.participation.uniqueAttendees], ['Participation rate', pct(k.participation.participationRate), 'of active members'], ['Avg per event', k.participation.averagePerEvent]] : []],
    ['finance', k.finance ? [
      ...(k.finance.contributions != null ? [['Contributions', money(k.finance.contributions)] as [string, any]] : []),
      ['Approved expenses', money(k.finance.expensesApproved)], ['Awaiting approval', k.finance.pendingApprovals], ['Awaiting release', k.finance.moneyRequestsAwaitingRelease]] : []],
    ['youth', k.youth ? [['Participants', k.youth.participants], ['Active', k.youth.active]] : []],
    ['resources', k.resources ? [['Available', k.resources.available], ['On loan', k.resources.onLoan], ['In maintenance', k.resources.inMaintenance], ['Overdue loans', k.resources.overdueLoans]] : []],
    ['volunteers', k.volunteers ? [['Volunteers', k.volunteers.volunteers], ['Hours served', k.volunteers.hoursServed], ['Attendance rate', pct(k.volunteers.attendanceRate)], ['Unfilled shifts (14d)', k.volunteers.unfilledShifts]] : []],
  ];
  const shown = groups.filter(([, items]) => items.length > 0);
  if (shown.length === 0) return <Empty text="No analytics are available for your role." />;
  return (
    <div className="space-y-6">
      {shown.map(([section, items]) => (
        <div key={section}>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{LABEL[section]}</h2><button className="text-sm font-medium text-primary hover:underline" onClick={() => go(section)}>Details →</button></div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{items.map(([l, v, h]) => <Stat key={l} label={l} value={v} hint={h} />)}</div>
        </div>
      ))}
      {data.unavailable?.length > 0 && <p className="text-sm text-amber-700">Some figures could not be loaded: {data.unavailable.map((s: Section) => LABEL[s]).join(', ')}.</p>}
    </div>
  );
}

function SectionTab({ section, query }: { section: Section; query: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [eventId, setEventId] = useState('');
  useEffect(() => {
    setData(null);
    const extra = section === 'participation' && eventId ? `&activityId=${eventId}` : '';
    axios.get(`/analytics/${section}?${query}${extra}`, { withCredentials: true }).then((r) => { setData(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load this section')));
  }, [section, query, eventId]);
  if (error) return <Empty text={error} />;
  if (!data) return <Spinner />;
  const tables = exportTables(section, data);
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><button className="btn btn-secondary btn-sm" onClick={() => downloadCsv(`analytics-${section}-${isoDay()}.csv`, tables)}><ArrowDownTrayIcon className="h-4 w-4" /> Export CSV</button></div>
      {section === 'membership' && <Membership d={data} />}
      {section === 'participation' && <Participation d={data} onEvent={setEventId} eventId={eventId} />}
      {section === 'finance' && <Finance d={data} />}
      {section === 'youth' && <Youth d={data} />}
      {section === 'resources' && <Resources d={data} />}
      {section === 'volunteers' && <Volunteers d={data} />}
    </div>
  );
}

function Membership({ d }: { d: any }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members" value={d.totals.total} /><Stat label="Active" value={d.totals.active} /><Stat label="Inactive" value={d.totals.inactive} /><Stat label="Graduated" value={d.totals.graduated} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Registrations by month"><Bars rows={d.growth} label={(r) => r.month} value={(r) => r.registered} /></Card>
        <Card title="Active members by department">
          <Bars rows={d.byDepartment} label={(r) => r.name ?? 'Unknown'} value={(r) => r.activeMembers} />
          {d.activeWithoutDepartment != null && <p className="mt-3 text-sm text-slate-500">{d.activeWithoutDepartment} active member{d.activeWithoutDepartment === 1 ? '' : 's'} not in any department.</p>}
        </Card>
      </div>
      <Card title="Status changes by month">
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>Month</th><th>Registered</th><th>Deactivated</th><th>Graduated</th><th>Reactivated</th></tr></thead>
          <tbody>{d.growth.map((g: any) => <tr key={g.month}><td>{g.month}</td><td>{g.registered}</td><td>{g.deactivated}</td><td>{g.graduated}</td><td>{g.reactivated}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  );
}

function Participation({ d, onEvent, eventId }: { d: any; onEvent: (id: string) => void; eventId: string }) {
  const t = d.totals;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Events" value={t.events} /><Stat label="Unique attendees" value={t.uniqueAttendees} hint={`of ${t.activeMembers} active members`} />
        <Stat label="Participation rate" value={pct(t.participationRate)} /><Stat label="Average per event" value={t.averagePerEvent} />
      </div>
      {t.memberLinkedShare != null && t.memberLinkedShare < 100 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Only {t.memberLinkedShare}% of attendance records are linked to a member; the rest were recorded by name only and cannot be attributed to a member or a department.</p>
      )}
      {d.truncated && <p className="text-sm text-amber-700">Showing the most recent events only; narrow the date range for a complete picture.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Attendance by month"><Bars rows={d.monthly} label={(r) => r.month} value={(r) => r.linked + r.nameOnly} /></Card>
        <Card title="By department"><Bars rows={d.byDepartment} label={(r) => r.name ?? 'Unknown'} value={(r) => r.attendance} /></Card>
      </div>
      <Card title="Recent events">
        {d.recentEvents.length === 0 ? <p className="text-sm text-slate-500">No events in this period.</p> : (
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Event</th><th>Date</th><th>Department</th><th>Members</th><th>Name only</th><th /></tr></thead>
            <tbody>{d.recentEvents.map((e: any) => <tr key={e.id}><td className="font-medium text-slate-900">{e.title}</td><td>{new Date(e.date).toLocaleDateString()}</td><td>{e.department || '—'}</td><td>{e.memberLinked}</td><td>{e.nameOnly}</td>
              <td className="text-right"><button className="btn btn-secondary btn-sm" onClick={() => onEvent(eventId === e.id ? '' : e.id)}>{eventId === e.id ? 'Hide' : 'Details'}</button></td></tr>)}</tbody></table></div>
        )}
      </Card>
      {d.event && (
        <Card title={`Event: ${d.event.title}`}>
          <p className="text-sm text-slate-600">{new Date(d.event.date).toLocaleString()} · {d.event.memberLinked} member-linked, {d.event.nameOnly} name-only</p>
          {d.event.attendeesByDepartment.length > 0 && <div className="mt-3"><Bars rows={d.event.attendeesByDepartment} label={(r) => r.name} value={(r) => r.attendees} /></div>}
        </Card>
      )}
    </>
  );
}

function Finance({ d }: { d: any }) {
  const c = d.contributions;
  return (
    <>
      {d.period && <p className="text-sm text-slate-600">Financial period: <span className="font-medium">{d.period.name}</span></p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {c && <Stat label="Contributions" value={money(c.total)} hint={`${c.count} record${c.count === 1 ? '' : 's'}`} />}
        {d.income && <Stat label="Other income" value={money(d.income.total)} />}
        <Stat label="Approved expenses" value={money(d.expenses.approvedTotal)} hint={`${d.expenses.pendingApprovalCount} awaiting approval`} />
        <Stat label="Released to requesters" value={money(d.moneyRequests.releasedTotal)} hint={`${d.moneyRequests.awaitingRelease} awaiting release`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {c && <Card title="Contributions by month"><Bars rows={c.monthly} label={(r) => r.month} value={(r) => Number(r.total)} fmt={money} /></Card>}
        {c && <Card title="Contributions by type"><Bars rows={c.byType} label={(r) => r.type} value={(r) => Number(r.total)} fmt={money} /></Card>}
        <Card title="Expenses by department"><Bars rows={d.expenses.byDepartment} label={(r) => r.name ?? 'Fellowship-wide'} value={(r) => Number(r.total)} fmt={money} /></Card>
        <Card title="Expenses by category"><Bars rows={d.expenses.byCategory} label={(r) => r.name} value={(r) => Number(r.total)} fmt={money} /></Card>
      </div>
      {d.budgetVsActual.length > 0 && (
        <Card title="Budget vs actual">
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Fiscal year</th><th>Department</th><th>Budgeted</th><th>Spent</th><th>Remaining</th></tr></thead>
            <tbody>{d.budgetVsActual.map((b: any, i: number) => <tr key={i}><td>{b.fiscalYear}</td><td>{b.departmentName || 'Fellowship-wide'}</td><td>{money(b.budgeted)}</td><td>{money(b.spent)}</td><td className={Number(b.remaining) < 0 ? 'text-rose-700' : ''}>{money(b.remaining)}</td></tr>)}</tbody></table></div>
        </Card>
      )}
    </>
  );
}

function Youth({ d }: { d: any }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><Stat label="Participants" value={d.totalParticipants} /><Stat label="Active" value={d.activeParticipants} /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="By age group"><Bars rows={d.byAgeGroup} label={(r) => r.ageGroupName} value={(r) => r.count} /></Card>
        <Card title="By status"><Bars rows={d.byStatus} label={(r) => r.status} value={(r) => r.count} /></Card>
      </div>
    </>
  );
}

function Resources({ d }: { d: any }) {
  const t = d.totals || {};
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Available" value={t.available ?? 0} /><Stat label="On loan" value={t.checked_out ?? 0} hint={`${d.loans.overdue} overdue`} /><Stat label="In maintenance" value={t.in_maintenance ?? 0} hint={`${d.maintenance.overdue} overdue`} />
        {d.acquisitionValue != null && <Stat label="Acquisition value" value={money(d.acquisitionValue)} />}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="By category"><Bars rows={d.byCategory} label={(r) => r.name} value={(r) => r.count} /></Card>
        <Card title="By condition"><Bars rows={d.byCondition} label={(r) => r.condition} value={(r) => r.count} /></Card>
        <Card title="By location"><Bars rows={d.byLocation} label={(r) => r.name} value={(r) => r.count} /></Card>
        <Card title="By department"><Bars rows={d.byDepartment} label={(r) => r.name} value={(r) => r.count} /></Card>
      </div>
      {d.lowStock?.length > 0 && <Card title="Low stock"><ul className="space-y-1 text-sm">{d.lowStock.map((s: any) => <li key={s.id} className="flex justify-between"><span>{s.name}</span><span className="text-amber-700">{s.quantity} / {s.reorder_level}</span></li>)}</ul></Card>}
    </>
  );
}

function Volunteers({ d }: { d: any }) {
  const p = d.participation;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Volunteers" value={p.volunteers} /><Stat label="Hours served" value={p.hoursServed} /><Stat label="Attendance rate" value={pct(p.attendanceRate)} /><Stat label="Shifts filled" value={pct(p.fillRate)} /><Stat label="Unfilled (14 days)" value={`${d.upcoming.unfilled} of ${d.upcoming.next14Days}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Service per month"><Bars rows={d.monthly} label={(r) => r.month} value={(r) => r.attended} /></Card>
        <Card title="By department"><Bars rows={d.byDepartment} label={(r) => r.department} value={(r) => r.attended} /></Card>
      </div>
      <Card title="By opportunity">
        {d.byOpportunity.length === 0 ? <p className="text-sm text-slate-500">Nothing in this period.</p> : (
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Opportunity</th><th>Shifts</th><th>Attended</th><th>No-show</th><th>Hours</th></tr></thead>
            <tbody>{d.byOpportunity.map((o: any) => <tr key={o.id}><td className="font-medium text-slate-900">{o.title}</td><td>{o.shifts}</td><td>{o.attended}</td><td>{o.no_show}</td><td>{o.hours}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  );
}

// What "Export CSV" writes for each tab: the same figures that are on screen, nothing more.
function exportTables(section: Section, d: any): CsvTable[] {
  switch (section) {
    case 'membership':
      return [
        { title: 'Totals', headers: ['Total', 'Active', 'Inactive', 'Graduated'], rows: [[d.totals.total, d.totals.active, d.totals.inactive, d.totals.graduated]] },
        { title: 'Status changes by month', headers: ['Month', 'Registered', 'Deactivated', 'Graduated', 'Reactivated'], rows: d.growth.map((g: any) => [g.month, g.registered, g.deactivated, g.graduated, g.reactivated]) },
        { title: 'Active members by department', headers: ['Department', 'Active members'], rows: d.byDepartment.map((x: any) => [x.name, x.activeMembers]) },
      ];
    case 'participation':
      return [
        { title: 'Totals', headers: ['Events', 'Attendance records', 'Member-linked', 'Name only', 'Unique attendees', 'Active members'], rows: [[d.totals.events, d.totals.attendanceRecords, d.totals.memberLinked, d.totals.nameOnly, d.totals.uniqueAttendees, d.totals.activeMembers]] },
        { title: 'By month', headers: ['Month', 'Events', 'Member-linked', 'Name only'], rows: d.monthly.map((m: any) => [m.month, m.events, m.linked, m.nameOnly]) },
        { title: 'Recent events', headers: ['Event', 'Date', 'Department', 'Member-linked', 'Name only'], rows: d.recentEvents.map((e: any) => [e.title, e.date, e.department, e.memberLinked, e.nameOnly]) },
      ];
    case 'finance':
      return [
        { title: 'Expenses by department', headers: ['Department', 'Approved total', 'Count'], rows: d.expenses.byDepartment.map((x: any) => [x.name, x.total, x.count]) },
        ...(d.contributions ? [{ title: 'Contributions by month', headers: ['Month', 'Total', 'Count'], rows: d.contributions.monthly.map((m: any) => [m.month, m.total, m.count]) }] : []),
        { title: 'Budget vs actual', headers: ['Fiscal year', 'Department', 'Budgeted', 'Spent', 'Remaining'], rows: d.budgetVsActual.map((b: any) => [b.fiscalYear, b.departmentName, b.budgeted, b.spent, b.remaining]) },
      ];
    case 'youth':
      return [{ title: 'By age group', headers: ['Age group', 'Participants'], rows: d.byAgeGroup.map((x: any) => [x.ageGroupName, x.count]) }, { title: 'By status', headers: ['Status', 'Participants'], rows: d.byStatus.map((x: any) => [x.status, x.count]) }];
    case 'resources':
      return [{ title: 'By category', headers: ['Category', 'Assets'], rows: d.byCategory.map((x: any) => [x.name, x.count]) }, { title: 'By condition', headers: ['Condition', 'Assets'], rows: d.byCondition.map((x: any) => [x.condition, x.count]) }];
    case 'volunteers':
      return [
        { title: 'By month', headers: ['Month', 'Attended', 'Hours'], rows: d.monthly.map((m: any) => [m.month, m.attended, m.hours]) },
        { title: 'By opportunity', headers: ['Opportunity', 'Department', 'Shifts', 'Attended', 'No-show', 'Hours'], rows: d.byOpportunity.map((o: any) => [o.title, o.department, o.shifts, o.attended, o.no_show, o.hours]) },
      ];
  }
}
