import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  PlusIcon, XMarkIcon, BookOpenIcon, PencilSquareIcon, TrashIcon,
} from '@heroicons/react/24/outline';

export default function Programmes() {
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchProgrammes();
  }, []);

  const fetchProgrammes = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/programmes', { withCredentials: true });
      setProgrammes(Array.isArray(res.data) ? res.data : res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load programmes');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description || '' });
    setError('');
    setShowModal(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`/programmes/${editing._id}`, form, { withCredentials: true });
      } else {
        await axios.post('/programmes', form, { withCredentials: true });
      }
      setShowModal(false);
      fetchProgrammes();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save programme');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: any) => {
    if (!window.confirm(`Delete programme "${p.name}"?`)) return;
    try {
      await axios.delete(`/programmes/${p._id}`, { withCredentials: true });
      fetchProgrammes();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete programme');
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Programmes</h1>
          <p className="page-desc">Manage the list of university courses for member registration.</p>
        </div>
        <button onClick={openCreate} className="btn btn-primary">
          <PlusIcon className="h-4 w-4" />
          Add Programme
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : programmes.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <BookOpenIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No programmes yet</p>
          <p className="empty-desc">Add the courses offered by your university.</p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Description</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {programmes.map((p) => (
                <tr key={p._id}>
                  <td className="font-medium text-slate-900">{p.name}</td>
                  <td className="text-slate-500">{p.description || '—'}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(p)} title="Edit" className="btn btn-secondary btn-sm">
                        <PencilSquareIcon className="h-4 w-4" />
                        Edit
                      </button>
                      <button onClick={() => remove(p)} title="Delete" className="btn btn-danger btn-sm">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <BookOpenIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {editing ? 'Edit Programme' : 'Add Programme'}
                  </h3>
                  <p className="text-xs text-slate-500">Course offered by the university.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <label className="label">Programme name *</label>
            <input
              className="input"
              required
              value={form.name}
              placeholder="e.g. BSc. Computer Science"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <label className="label mt-4">Description</label>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save Programme'}
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
