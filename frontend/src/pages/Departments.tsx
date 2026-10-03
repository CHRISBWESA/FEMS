import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  BuildingOfficeIcon, UserGroupIcon, ArrowRightIcon,
  PlusIcon, XMarkIcon, PencilSquareIcon, PlayCircleIcon, PauseCircleIcon,
} from '@heroicons/react/24/outline';

const emptyForm = {
  name: '',
  description: '',
};

export default function Departments() {
  const { user } = useAuth();
  const canManage = user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary');
  const canEdit = user?.roles.includes('secretary');
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/departments', { withCredentials: true });
      setDepartments(res.data);
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

  const openEdit = (dept: any) => {
    setForm({ name: dept.name, description: dept.description || '' });
    setError('');
    setEditing(dept);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`/departments/${editing.id}`, form, { withCredentials: true });
      } else {
        await axios.post('/departments', form, { withCredentials: true });
      }
      setShowCreate(false);
      setEditing(null);
      fetchDepartments();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (dept: any) => {
    try {
      await axios.put(`/departments/${dept.id}`, { is_active: !dept.is_active }, { withCredentials: true });
      fetchDepartments();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update department');
    }
  };

  // Secretaries see everything (including inactive); everyone else sees active only.
  const visibleDepartments = canEdit
    ? departments
    : departments.filter((d: any) => d.is_active !== false);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-desc">Departments and their leadership.</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            Add Department
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : visibleDepartments.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <BuildingOfficeIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No departments found</p>
          <p className="empty-desc">Departments will appear here once created.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleDepartments.map((dept: any) => (
            <div key={dept.id} className="card card-hover group relative text-left">
              <button onClick={() => navigate(`/departments/${dept.id}`)} className="block w-full text-left">
                <div className="flex items-start justify-between">
                  <div className={`stat-icon ${dept.is_active === false ? 'bg-surface-sunken text-ink-subtle' : 'bg-emerald-50 text-success'}`}>
                    <BuildingOfficeIcon className="h-6 w-6" />
                  </div>
                  <ArrowRightIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
                </div>
                <h3 className={`mt-4 text-base font-semibold ${dept.is_active === false ? 'text-ink-subtle' : 'text-ink'}`}>{dept.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                  {dept.description || 'No description'}
                </p>
                <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
                  <UserGroupIcon className="h-4 w-4 text-ink-subtle" />
                  {dept.leaders?.length ?? 0} leader(s)
                  <span className={`status-badge ml-auto ${dept.is_active === false ? 'status-inactive' : 'status-active'}`}>
                    {dept.is_active === false ? 'Inactive' : 'Active'}
                  </span>
                </div>
              </button>
              {canEdit && (
                <div className="absolute right-3 top-12 flex flex-col gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(dept); }}
                    className="btn btn-icon"
                    title="Edit department"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleActive(dept); }}
                    className="btn btn-icon"
                    title={dept.is_active === false ? 'Activate department' : 'Deactivate department'}
                  >
                    {dept.is_active === false
                      ? <PlayCircleIcon className="h-4 w-4 text-success" />
                      : <PauseCircleIcon className="h-4 w-4 text-amber-600" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <div
          className="modal-backdrop"
          onClick={() => { setShowCreate(false); setEditing(null); }}
        >
          <form
            onSubmit={submitForm}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-md"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <BuildingOfficeIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {editing ? 'Edit Department' : 'Add Department'}
                  </h3>
                  <p className="text-xs text-ink-muted">
                    {editing ? 'Update department details.' : 'Create a new department.'}
                  </p>
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

            <div className="space-y-4">
              <div>
                <label className="label">Name *</label>
                <input
                  className="input"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : editing ? 'Save Changes' : 'Create Department'}
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
