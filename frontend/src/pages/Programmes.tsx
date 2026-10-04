import { useState, useEffect } from 'react';
import axios from 'axios';
import { PageLoader } from '../components/ui';
import {
  PlusIcon, XMarkIcon, BookOpenIcon, PencilSquareIcon, TrashIcon,
  CloudArrowUpIcon, DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';

const CSV_HEADERS = ['name', 'description'];
const CSV_TEMPLATE_ROWS = [
  'BSc. Computer Science,"Computing, software and systems"',
  'BBA,Business administration',
];

export default function Programmes() {
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

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
        await axios.put(`/programmes/${editing.id}`, form, { withCredentials: true });
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
      await axios.delete(`/programmes/${p.id}`, { withCredentials: true });
      fetchProgrammes();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete programme');
    }
  };

  const downloadTemplate = () => {
    const csv = [CSV_HEADERS.join(','), ...CSV_TEMPLATE_ROWS].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'programmes-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setError('Please choose a CSV file');
      return;
    }
    setError('');
    setUploadResult(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const res = await axios.post('/programmes/bulk-upload', fd, { withCredentials: true });
      setUploadResult(res.data);
      fetchProgrammes();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to upload CSV');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Programmes</h1>
          <p className="page-desc">Manage the list of university courses for member registration.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setError(''); setShowUpload(true); setUploadResult(null); setUploadFile(null); }} className="btn btn-secondary">
            <CloudArrowUpIcon className="h-4 w-4" />
            Bulk Upload
          </button>
          <button onClick={openCreate} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            Add Programme
          </button>
        </div>
      </div>

      {error && !showModal && (
        <div className="alert alert-danger mb-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader rows={2} />
      ) : programmes.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
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
                <tr key={p.id}>
                  <td className="font-medium text-ink">{p.name}</td>
                  <td className="text-ink-muted">{p.description || '—'}</td>
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
                  <h3 className="text-base font-semibold text-ink">
                    {editing ? 'Edit Programme' : 'Add Programme'}
                  </h3>
                  <p className="text-xs text-ink-muted">Course offered by the university.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="alert alert-danger mb-4" role="alert">
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
      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <form
            onSubmit={submitUpload}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-lg"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <CloudArrowUpIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Bulk Upload Programmes</h3>
                  <p className="text-xs text-ink-muted">Import courses from a CSV file.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-primary-light px-4 py-3 text-sm text-ink-muted">
              Columns: <span className="font-mono text-xs">{CSV_HEADERS.join(', ')}</span>
              <br />
              <span className="text-xs text-ink-muted">Only <span className="font-mono">name</span> is required. Duplicates are skipped and reported.</span>
            </div>

            <button type="button" onClick={downloadTemplate} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-dark">
              <DocumentArrowDownIcon className="h-4 w-4" />
              Download template CSV
            </button>

            {error && showUpload && (
              <div className="alert alert-danger mb-4" role="alert">
                {error}
              </div>
            )}

            <label className="label">CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              required
              className="input"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />

            {uploadResult && (
              <div className="mt-4 rounded-lg border border-hairline bg-white p-4">
                <p className="text-sm font-semibold text-ink">
                  Import complete: {uploadResult.created} created, {uploadResult.failed} skipped/failed
                </p>
                {uploadResult.failures?.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-rose-700">
                    {uploadResult.failures.map((f: any, idx: number) => (
                      <li key={idx}>Row {f.row}: {f.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={uploading} className="btn btn-primary flex-1">
                {uploading ? <span className="spinner border-white" /> : 'Upload & Import'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-secondary flex-1">
                {uploadResult ? 'Close' : 'Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
