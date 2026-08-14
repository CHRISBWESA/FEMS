import { useState, useEffect } from 'react';
import axios from 'axios';
import { CurrencyDollarIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function Finance() {
  const [activeTab, setActiveTab] = useState('contributions');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const tabs = [
    { id: 'contributions', label: 'Contributions' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'budgets', label: 'Budgets' },
    { id: 'money-requests', label: 'Money Requests' },
  ];

  useEffect(() => {
    fetchTab();
  }, [activeTab]);

  const fetchTab = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/finance/${activeTab}`, { withCredentials: true });
      setData(res.data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (type: string, id: string, decision: string) => {
    try {
      await axios.post(`/finance/${type}/${id}/approve`, {
        decision,
        comment: 'Reviewed',
      }, { withCredentials: true });
      fetchTab();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const formatValue = (key: string, value: any) => {
    if (typeof value === 'object') return JSON.stringify(value);
    if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('budget')) {
      const num = Number(value);
      if (!isNaN(num)) return `$${num.toLocaleString()}`;
    }
    return String(value);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-desc">Contributions, expenses, budgets and money requests.</p>
        </div>
      </div>

      <div className="tabs mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : Array.isArray(data) && data.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <CurrencyDollarIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No records found</p>
          <p className="empty-desc">No {activeTab.replace('-', ' ')} records yet.</p>
        </div>
      ) : Array.isArray(data) ? (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {Object.keys(data[0] || {}).filter(k => k !== '_id' && k !== '__v').map(key => (
                  <th key={key}>
                    {key.replace(/_/g, ' ')}
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item: any) => (
                <tr key={item._id}>
                  {Object.entries(item).filter(([k]) => k !== '_id' && k !== '__v').map(([key, value]: [string, any]) => (
                    <td key={key} className={key === 'amount' ? 'font-medium text-slate-900' : ''}>
                      {formatValue(key, value)}
                    </td>
                  ))}
                  <td>
                    {item.approval_status === 'SUBMITTED' && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleApprove(activeTab.replace('-', '_'), item._id, 'approved')}
                          className="btn btn-success btn-sm"
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleApprove(activeTab.replace('-', '_'), item._id, 'rejected')}
                          className="btn btn-danger btn-sm"
                        >
                          <XMarkIcon className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
