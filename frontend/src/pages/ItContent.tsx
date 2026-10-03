import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import {
  DocumentTextIcon, MegaphoneIcon, PhotoIcon,
  PlusIcon, XMarkIcon, CloudArrowUpIcon, CheckIcon,
} from '@heroicons/react/24/outline';

const emptyDocForm = { title: '', departmentId: '', isWebsiteContent: false };
const emptyAnnForm = { title: '', content: '', audienceType: 'all_members', departmentId: '' };

export default function ItContent() {
  const { user } = useAuth();
  const canUpload =
    user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary') ||
    user?.roles.includes('department_secretary') || user?.roles.includes('department_chairperson');
  const canAnnounce = user?.roles.includes('secretary') || user?.roles.includes('assistant_secretary');
  const canApproveAnnouncement =
    user?.roles.includes('chairperson') || user?.roles.includes('assistant_chairperson');
  const canReviewDocument = (status: string) =>
    (user?.roles.includes('department_secretary') && ['SUBMITTED', 'RESUBMITTED'].includes(status)) ||
    ((user?.roles.includes('chairperson') || user?.roles.includes('assistant_chairperson')) && status === 'UNDER_REVIEW');

  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [docForm, setDocForm] = useState(emptyDocForm);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // announcement modal
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [annForm, setAnnForm] = useState(emptyAnnForm);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      axios.get('/it-content/documents', { withCredentials: true }).then(res => setDocuments(res.data)),
      axios.get('/it-content/announcements', { withCredentials: true }).then(res => setAnnouncements(res.data)),
      axios.get('/it-content/gallery', { withCredentials: true }).then(res => setGallery(res.data)),
    ]).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
    axios.get('/departments', { withCredentials: true })
      .then(res => setDepartments(res.data))
      .catch(() => {});
  }, []);

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError('');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', docForm.title);
      if (docForm.departmentId) fd.append('departmentId', docForm.departmentId);
      if (docForm.isWebsiteContent) fd.append('isWebsiteContent', 'true');
      await axios.post('/it-content/documents', fd, { withCredentials: true });
      setShowUpload(false);
      setDocForm(emptyDocForm);
      setFile(null);
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to upload document');
    } finally {
      setSaving(false);
    }
  };

  const submitDocument = async (id: string) => {
    try {
      await axios.post(`/it-content/documents/${id}/submit`, {}, { withCredentials: true });
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to submit for approval');
    }
  };

  const approveDocument = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await axios.post(`/it-content/documents/${id}/approve`, { decision }, { withCredentials: true });
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const submitAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload: any = { ...annForm };
      if (payload.audienceType !== 'department') delete payload.departmentId;
      await axios.post('/it-content/announcements', payload, { withCredentials: true });
      setShowAnnouncement(false);
      setAnnForm(emptyAnnForm);
      fetchAll();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create announcement');
    } finally {
      setSaving(false);
    }
  };

  const approveAnnouncement = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await axios.post(`/it-content/announcements/${id}/approve`, { decision }, { withCredentials: true });
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const tabs = [
    { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
    { id: 'announcements', label: 'Announcements', icon: MegaphoneIcon },
    { id: 'gallery', label: 'Gallery', icon: PhotoIcon },
  ];

  const boundedListNotice = (count: number, noun: string) => count >= 500 ? (
    <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20" role="status">
      Showing the 500 most recent {noun}. Use search or filters to narrow the list.
    </div>
  ) : null;

  const statusClass = (s: string) =>
    s === 'approved' || s === 'FINAL_APPROVED' ? 'status-approved'
    : s === 'rejected' || s === 'REJECTED' ? 'status-rejected'
    : s === 'published' || s === 'PUBLISHED' ? 'status-approved'
    : s === 'DRAFT' ? 'status-draft'
    : 'status-submitted';

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">IT Content</h1>
          <p className="page-desc">Documents, announcements and media for the fellowship.</p>
        </div>
        {activeTab === 'documents' && canUpload && (
          <button onClick={() => { setError(''); setShowUpload(true); }} className="btn btn-primary">
            <CloudArrowUpIcon className="h-4 w-4" />
            Upload Document
          </button>
        )}
        {activeTab === 'announcements' && canAnnounce && (
          <button onClick={() => { setError(''); setShowAnnouncement(true); }} className="btn btn-primary">
            <PlusIcon className="h-4 w-4" />
            New Announcement
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      <div className="tabs mb-6 sm:w-96">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab flex items-center justify-center gap-2 ${activeTab === tab.id ? 'tab-active' : ''}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : activeTab === 'documents' ? (
        documents.length === 0 ? (
          <div className="empty-state">
            <div className="stat-icon bg-surface-sunken text-ink-subtle">
              <DocumentTextIcon className="h-6 w-6" />
            </div>
            <p className="empty-title">No documents found</p>
          </div>
        ) : (
          <>
            {boundedListNotice(documents.length, 'documents')}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {documents.map((d: any) => (
              <div key={d.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="stat-icon bg-indigo-50 text-indigo-600">
                    <DocumentTextIcon className="h-5 w-5" />
                  </div>
                  <span className={`status-badge ${statusClass(d.approval_status)}`}>
                    {(d.approval_status || 'pending').toLowerCase().replace('_', ' ')}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{d.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">File: {d.filename}</p>
                {(d.uploaded_by === user?.id || canAnnounce) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
                    {d.approval_status === 'DRAFT' && (
                      <button onClick={() => submitDocument(d.id)} className="btn btn-secondary btn-sm">
                        Submit for Approval
                      </button>
                    )}
                    {canReviewDocument(d.approval_status) && (
                      <>
                        <button onClick={() => approveDocument(d.id, 'approved')} className="btn btn-success btn-sm">
                          <CheckIcon className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button onClick={() => approveDocument(d.id, 'rejected')} className="btn btn-danger btn-sm">
                          <XMarkIcon className="h-3.5 w-3.5" /> Reject
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            </div>
          </>
        )
      ) : activeTab === 'announcements' ? (
        announcements.length === 0 ? (
          <div className="empty-state">
            <div className="stat-icon bg-surface-sunken text-ink-subtle">
              <MegaphoneIcon className="h-6 w-6" />
            </div>
            <p className="empty-title">No announcements found</p>
          </div>
        ) : (
          <>
            {boundedListNotice(announcements.length, 'announcements')}
            <div className="space-y-4">
            {announcements.map((a: any) => (
              <div key={a.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink">{a.title}</h3>
                  <span className={`status-badge ${statusClass(a.status)}`}>{(a.status || '').toLowerCase()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{a.content}</p>
                {canApproveAnnouncement && ['DRAFT', 'REJECTED'].includes(a.status) && a.created_by !== user?.id && (
                  <div className="mt-3 flex gap-2 border-t border-hairline pt-3">
                    <button onClick={() => approveAnnouncement(a.id, 'approved')} className="btn btn-success btn-sm">
                      <CheckIcon className="h-3.5 w-3.5" /> Approve & Publish
                    </button>
                    <button onClick={() => approveAnnouncement(a.id, 'rejected')} className="btn btn-danger btn-sm">
                      <XMarkIcon className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
            </div>
          </>
        )
      ) : gallery.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <PhotoIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No gallery images found</p>
        </div>
      ) : (
        <>
          {boundedListNotice(gallery.length, 'gallery images')}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {gallery.map((img: any) => (
            <div key={img.id} className="card">
              <div className="flex aspect-square items-center justify-center rounded-lg bg-surface-sunken">
                <PhotoIcon className="h-8 w-8 text-ink-subtle" />
              </div>
              <p className="mt-2 text-center text-sm font-medium text-ink">{img.title}</p>
            </div>
          ))}
          </div>
        </>
      )}

      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <form onSubmit={submitUpload} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-indigo-50 text-indigo-600">
                  <CloudArrowUpIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Upload Document</h3>
                  <p className="text-xs text-ink-muted">Saved as draft; submit it for approval after upload.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Title *</label>
                <input required className="input" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Department</label>
                <select className="select" value={docForm.departmentId} onChange={(e) => setDocForm({ ...docForm, departmentId: e.target.value })}>
                  <option value="">General / none</option>
                  {departments.filter(d => d.is_active !== false).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={docForm.isWebsiteContent} onChange={(e) => setDocForm({ ...docForm, isWebsiteContent: e.target.checked })} />
                This is website content
              </label>
              <div>
                <label className="label">File *</label>
                <input type="file" required className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Upload'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showAnnouncement && (
        <div className="modal-backdrop" onClick={() => setShowAnnouncement(false)}>
          <form onSubmit={submitAnnouncement} onClick={(e) => e.stopPropagation()} className="modal max-w-lg">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-amber-50 text-amber-600">
                  <MegaphoneIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">New Announcement</h3>
                  <p className="text-xs text-ink-muted">Requires chairperson approval before publishing.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAnnouncement(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Title *</label>
                <input required className="input" value={annForm.title} onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Content *</label>
                <textarea required rows={6} className="input" value={annForm.content} onChange={(e) => setAnnForm({ ...annForm, content: e.target.value })} />
              </div>
              <div>
                <label className="label">Audience *</label>
                <select className="select" value={annForm.audienceType} onChange={(e) => setAnnForm({ ...annForm, audienceType: e.target.value })}>
                  <option value="all_members">All members</option>
                  <option value="department">Department</option>
                  <option value="leaders">Leaders</option>
                </select>
              </div>
              {annForm.audienceType === 'department' && (
                <div>
                  <label className="label">Department</label>
                  <select required className="select" value={annForm.departmentId} onChange={(e) => setAnnForm({ ...annForm, departmentId: e.target.value })}>
                    <option value="">Select department…</option>
                    {departments.filter(d => d.is_active !== false).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Create Announcement'}
              </button>
              <button type="button" onClick={() => setShowAnnouncement(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
