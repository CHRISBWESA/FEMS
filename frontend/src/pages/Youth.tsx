import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import ListLimitNotice from '../components/ListLimitNotice';
import { totalFromHeaders } from '../lib/list-total';
import {
  FaceSmileIcon, ArrowRightIcon, PlusIcon, XMarkIcon,
} from '@heroicons/react/24/outline';

const emptyForm = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  departmentId: '',
};

export default function Youth() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('youth.create');
  const canSeeDetails = hasPermission('youth.details_view');
  const [participants, setParticipants] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [listTotal, setListTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchParticipants();
    axios.get('/departments', { withCredentials: true }).then((res) => setDepartments(res.data)).catch(() => {});
  }, []);

  const fetchParticipants = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/youth', { withCredentials: true });
      setParticipants(res.data);
      setListTotal(totalFromHeaders(res.headers));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setError('');
    setShowCreate(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.post('/youth', {
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender || undefined,
        departmentId: form.departmentId || undefined,
      }, { withCredentials: true });
      setShowCreate(false);
      fetchParticipants();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save participant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Youth &amp; Children</h1>
          <p className="page-desc">Participants, age groups and their fellowship engagement.</p>
        </div>
        {canCreate && (
          <button onClick={openCreate} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            Add Participant
          </button>
        )}
      </div>

      <ListLimitNotice shown={participants.length} total={listTotal} noun="participants" />
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : participants.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <FaceSmileIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No participants found</p>
          <p className="empty-desc">Youth and children participants will appear here once added.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {participants.map((p: any) => (
            <button
              key={p.id}
              onClick={() => navigate(`/youth/${p.id}`)}
              className="card card-hover group relative block w-full text-left"
            >
              <div className="flex items-start justify-between">
                <div className="stat-icon bg-primary-light text-primary">
                  <FaceSmileIcon className="h-6 w-6" />
                </div>
                <ArrowRightIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{p.fullName}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {p.ageGroup?.name || 'No age group assigned'}
                {canSeeDetails && p.age !== undefined ? ` · ${p.age} yrs` : ''}
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <span className={`status-badge ${p.status === 'active' ? 'status-active' : 'status-inactive'}`}>
                  {p.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form onSubmit={submitForm} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <FaceSmileIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Add Participant</h3>
                  <p className="text-xs text-slate-500">Register a youth or child participant.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input
                  className="input"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Date of Birth *</label>
                <input
                  type="date"
                  className="input"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth}
                  onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Gender</label>
                <input
                  className="input"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Department</label>
                <select
                  className="select"
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                >
                  <option value="">No department</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Add Participant'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
