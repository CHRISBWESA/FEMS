import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import ListLimitNotice from '../components/ListLimitNotice';
import { totalFromHeaders } from '../lib/list-total';
import {
  CalendarIcon, MapPinIcon, ClockIcon, PlusIcon, XMarkIcon,
  LinkIcon, NoSymbolIcon, PencilSquareIcon,
} from '@heroicons/react/24/outline';

const emptyForm = {
  title: '',
  description: '',
  date: '',
  endDate: '',
  audienceType: 'all_members',
  departmentId: '',
  specificGroup: '',
};

export default function Activities() {
  const { user } = useAuth();
  const canManage = user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary');
  const [activities, setActivities] = useState([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [listTotal, setListTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchActivities();
    axios.get('/departments', { withCredentials: true })
      .then(res => setDepartments(res.data))
      .catch(() => {});
  }, []);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/activities', { withCredentials: true });
      setActivities(res.data);
      setListTotal(totalFromHeaders(res.headers));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm({ ...emptyForm });
    setError('');
    setShowCreate(true);
  };

  const openEdit = (a: any) => {
    setForm({
      title: a.title || '',
      description: a.description || '',
      date: a.date ? new Date(a.date).toISOString().slice(0, 16) : '',
      endDate: a.end_date ? new Date(a.end_date).toISOString().slice(0, 16) : '',
      audienceType: a.audience_type || 'all_members',
      departmentId: a.department_id || '',
      specificGroup: a.specific_group || '',
    });
    setError('');
    setEditing(a);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date) {
      setError('Date is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload: any = {
        title: form.title,
        description: form.description || undefined,
        date: new Date(form.date).toISOString(),
        audienceType: form.audienceType,
      };
      if (form.endDate) payload.endDate = new Date(form.endDate).toISOString();
      if (form.audienceType === 'department') payload.departmentId = form.departmentId || undefined;
      if (form.audienceType === 'specific_group') payload.specificGroup = form.specificGroup || undefined;

      if (editing) {
        await axios.put(`/activities/${editing.id}`, payload, { withCredentials: true });
      } else {
        await axios.post('/activities', payload, { withCredentials: true });
      }
      setShowCreate(false);
      setEditing(null);
      fetchActivities();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save activity');
    } finally {
      setSaving(false);
    }
  };

  const cancelActivity = async (a: any) => {
    if (!confirm(`Cancel "${a.title}"?`)) return;
    try {
      await axios.post(`/activities/${a.id}/cancel`, {}, { withCredentials: true });
      fetchActivities();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to cancel activity');
    }
  };

  const generateLink = async (a: any) => {
    try {
      const res = await axios.post(`/activities/${a.id}/attendance-link`, {}, { withCredentials: true });
      const url = res.data?.url || res.data?.link || `${window.location.origin}/attendance/${a.id}`;
      await navigator.clipboard.writeText(url);
      alert(`Attendance link copied:\n${url}`);
    } catch {
      // Fallback: show the canonical URL even if the API call fails
      navigator.clipboard.writeText(`${window.location.origin}/attendance/${a.id}`).catch(() => {});
      alert(`Attendance link: ${window.location.origin}/attendance/${a.id}`);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Activities</h1>
          <p className="page-desc">Upcoming and past fellowship activities.</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            Add Activity
          </button>
        )}
      </div>

      <ListLimitNotice shown={activities.length} total={listTotal} noun="activities" />
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : activities.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No activities found</p>
          <p className="empty-desc">Activities will appear here once scheduled.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((a: any) => (
            <div key={a.id} className="card card-hover block w-full text-left">
              <button onClick={() => navigate(`/activities/${a.id}`)} className="block w-full text-left">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="stat-icon bg-indigo-50 text-indigo-600">
                      <CalendarIcon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className={`text-base font-semibold ${a.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {a.title}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {new Date(a.date).toLocaleString()}
                        </span>
                        {a.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPinIcon className="h-4 w-4" />
                            {a.location}
                          </span>
                        )}
                      </div>
                      {a.description && (
                        <p className="mt-2 text-sm text-slate-600">{a.description}</p>
                      )}
                    </div>
                  </div>
                  <span className={`status-badge ${a.status === 'cancelled' ? 'status-inactive' : 'status-submitted'}`}>
                    {a.status === 'cancelled' ? 'Cancelled' : a.audience_type?.replace('_', ' ') || 'All'}
                  </span>
                </div>
              </button>
              {canManage && (
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(a); }} className="btn btn-secondary btn-sm">
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); generateLink(a); }} className="btn btn-secondary btn-sm">
                    <LinkIcon className="h-4 w-4" />
                    Attendance Link
                  </button>
                  {a.status !== 'cancelled' && (
                    <button onClick={(e) => { e.stopPropagation(); cancelActivity(a); }} className="btn btn-secondary btn-sm text-rose-600">
                      <NoSymbolIcon className="h-4 w-4" />
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <div className="modal-backdrop" onClick={() => { setShowCreate(false); setEditing(null); }}>
          <form onSubmit={submitForm} onClick={(e) => e.stopPropagation()} className="modal max-w-lg">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-indigo-50 text-indigo-600">
                  <CalendarIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {editing ? 'Edit Activity' : 'Add Activity'}
                  </h3>
                  <p className="text-xs text-slate-500">Members are notified when an activity is created.</p>
                </div>
              </div>
              <button type="button" onClick={() => { setShowCreate(false); setEditing(null); }} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Title *</label>
                <input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Description</label>
                <textarea rows={3} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className="label">Start *</label>
                <input type="datetime-local" required className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="label">End</label>
                <input type="datetime-local" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div>
                <label className="label">Audience</label>
                <select className="select" value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })}>
                  <option value="all_members">All members</option>
                  <option value="department">Department</option>
                  <option value="leaders">Leaders</option>
                  <option value="specific_group">Specific group</option>
                </select>
              </div>
              {form.audienceType === 'department' && (
                <div>
                  <label className="label">Department</label>
                  <select className="select" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">Select department…</option>
                    {departments.filter((d) => d.is_active !== false).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {form.audienceType === 'specific_group' && (
                <div>
                  <label className="label">Group name</label>
                  <input className="input" placeholder="e.g. Final years" value={form.specificGroup} onChange={(e) => setForm({ ...form, specificGroup: e.target.value })} />
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : editing ? 'Save Changes' : 'Create Activity'}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setEditing(null); }} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
