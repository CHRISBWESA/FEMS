import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import { RectangleStackIcon, PlusIcon, XMarkIcon, PencilSquareIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { PageLoader } from '../components/ui';

const emptyForm = { name: '', minAge: '', maxAge: '', description: '' };

export default function YouthAgeGroups() {
  const { hasRole } = useAuth();
  const canManage = hasRole('secretary');
  const [ageGroups, setAgeGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    fetchAgeGroups();
  }, []);

  const fetchAgeGroups = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/youth/age-groups', { withCredentials: true });
      setAgeGroups(res.data);
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

  const openEdit = (g: any) => {
    setForm({ name: g.name, minAge: String(g.min_age), maxAge: String(g.max_age), description: g.description || '' });
    setError('');
    setEditing(g);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        minAge: Number(form.minAge),
        maxAge: Number(form.maxAge),
        description: form.description || undefined,
      };
      if (editing) {
        await axios.put(`/youth/age-groups/${editing.id}`, payload, { withCredentials: true });
      } else {
        await axios.post('/youth/age-groups', payload, { withCredentials: true });
      }
      setShowCreate(false);
      setEditing(null);
      fetchAgeGroups();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save age group');
    } finally {
      setSaving(false);
    }
  };

  const recalculate = async () => {
    setRecalculating(true);
    try {
      const res = await axios.post('/youth/age-groups/recalculate', {}, { withCredentials: true });
      alert(`Updated age group assignment for ${res.data.updated} participant(s).`);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to recalculate age groups');
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Age Groups</h1>
          <p className="page-desc">Configure the age ranges used to classify youth &amp; children participants.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={recalculate} disabled={recalculating} className="btn btn-secondary">
              <ArrowPathIcon className="h-4 w-4" />
              Recalculate Assignments
            </button>
            <button onClick={openCreate} className="btn btn-primary">
              <PlusIcon className="h-4 w-4" />
              Add Age Group
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <PageLoader rows={2} />
      ) : ageGroups.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <RectangleStackIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No age groups configured</p>
          <p className="empty-desc">Add ranges like "Children (0-9)" or "Teens (13-17)" to classify participants.</p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Age Range</th><th>Description</th><th>Status</th>{canManage && <th></th>}</tr>
            </thead>
            <tbody>
              {ageGroups.map((g: any) => (
                <tr key={g.id}>
                  <td className="font-medium text-ink">{g.name}</td>
                  <td>{g.min_age}–{g.max_age} yrs</td>
                  <td className="text-ink-muted">{g.description || '—'}</td>
                  <td>
                    <span className={`status-badge ${g.is_active ? 'status-active' : 'status-inactive'}`}>
                      {g.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button onClick={() => openEdit(g)} className="btn btn-icon" title="Edit age group">
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editing) && (
        <div className="modal-backdrop" onClick={() => { setShowCreate(false); setEditing(null); }}>
          <form onSubmit={submitForm} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <RectangleStackIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {editing ? 'Edit Age Group' : 'Add Age Group'}
                  </h3>
                  <p className="text-xs text-ink-muted">Ranges must not overlap an existing active age group.</p>
                </div>
              </div>
              <button type="button" onClick={() => { setShowCreate(false); setEditing(null); }} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="alert alert-danger mb-4" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="label">Name *</label>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Min Age *</label>
                  <input type="number" min={0} className="input" required value={form.minAge} onChange={(e) => setForm({ ...form, minAge: e.target.value })} />
                </div>
                <div>
                  <label className="label">Max Age *</label>
                  <input type="number" min={0} className="input" required value={form.maxAge} onChange={(e) => setForm({ ...form, maxAge: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : editing ? 'Save Changes' : 'Create Age Group'}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setEditing(null); }} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
