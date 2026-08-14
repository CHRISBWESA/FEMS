import { useState, useEffect } from 'react';
import axios from 'axios';
import { ComputerDesktopIcon, DocumentTextIcon, MegaphoneIcon, PhotoIcon } from '@heroicons/react/24/outline';

export default function ItContent() {
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get('/it-content/documents', { withCredentials: true }).then(res => setDocuments(res.data)),
      axios.get('/it-content/announcements', { withCredentials: true }).then(res => setAnnouncements(res.data)),
      axios.get('/it-content/gallery', { withCredentials: true }).then(res => setGallery(res.data)),
    ]).finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
    { id: 'announcements', label: 'Announcements', icon: MegaphoneIcon },
    { id: 'gallery', label: 'Gallery', icon: PhotoIcon },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">IT Content</h1>
          <p className="page-desc">Documents, announcements and media for the fellowship.</p>
        </div>
      </div>

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
            <div className="stat-icon bg-slate-100 text-slate-400">
              <DocumentTextIcon className="h-6 w-6" />
            </div>
            <p className="empty-title">No documents found</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {documents.map((d: any) => (
              <div key={d._id} className="card">
                <div className="flex items-start justify-between">
                  <div className="stat-icon bg-indigo-50 text-indigo-600">
                    <DocumentTextIcon className="h-5 w-5" />
                  </div>
                  <span className={`status-badge ${d.approval_status === 'approved' ? 'status-approved' : d.approval_status === 'rejected' ? 'status-rejected' : 'status-submitted'}`}>
                    {d.approval_status || 'pending'}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">{d.title}</h3>
                <p className="mt-1 text-sm text-slate-500">File: {d.filename}</p>
              </div>
            ))}
          </div>
        )
      ) : activeTab === 'announcements' ? (
        announcements.length === 0 ? (
          <div className="empty-state">
            <div className="stat-icon bg-slate-100 text-slate-400">
              <MegaphoneIcon className="h-6 w-6" />
            </div>
            <p className="empty-title">No announcements found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {announcements.map((a: any) => (
              <div key={a._id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">{a.title}</h3>
                  <span className={`status-badge ${a.status === 'published' ? 'status-approved' : 'status-submitted'}`}>
                    {a.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{a.content}</p>
              </div>
            ))}
          </div>
        )
      ) : gallery.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <PhotoIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No gallery images found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {gallery.map((img: any) => (
            <div key={img._id} className="card">
              <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100">
                <PhotoIcon className="h-8 w-8 text-slate-400" />
              </div>
              <p className="mt-2 text-center text-sm font-medium text-slate-700">{img.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
