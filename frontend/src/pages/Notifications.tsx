import { useState, useEffect } from 'react';
import axios from 'axios';
import { BellIcon, CheckBadgeIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/notifications', { withCredentials: true });
      setNotifications(res.data.data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await axios.get('/notifications/unread-count', { withCredentials: true });
      setUnreadCount(res.data.count);
    } catch (err: any) {
      console.error(err);
    }
  };

  const markRead = async (id: string) => {
    try {
      await axios.patch(`/notifications/${id}/read`, {}, { withCredentials: true });
      setNotifications(notifications.map((n: any) =>
        n.id === id ? { ...n, is_read: true } : n
      ));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch (err: any) {
      console.error(err);
    }
  };

  const markAllRead = async () => {
    try {
      await axios.patch('/notifications/mark-all-read', {}, { withCredentials: true });
      setNotifications(notifications.map((n: any) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-desc">Stay up to date with approvals and system events.</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="btn btn-primary btn-sm">
            <CheckBadgeIcon className="h-4 w-4" />
            Mark All Read ({unreadCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <BellIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No notifications</p>
          <p className="empty-desc">Notifications about approvals and events will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n: any) => (
            <div
              key={n.id}
              className={`card flex items-start justify-between gap-4 transition-colors ${
                n.is_read ? 'opacity-70' : 'ring-1 ring-primary/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`stat-icon ${n.is_read ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                  <BellIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-slate-900">{n.title}</h3>
                    {!n.is_read && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xxs font-semibold text-white">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{n.message}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
              {!n.is_read && (
                <button
                  onClick={() => markRead(n.id)}
                  className="btn btn-ghost btn-sm shrink-0"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  Mark Read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
