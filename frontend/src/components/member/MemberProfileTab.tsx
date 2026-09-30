import { useEffect, useState } from 'react';
import axios from 'axios';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';

const CHANNELS = ['email', 'sms', 'phone', 'whatsapp', 'in_app'];
const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function Tags({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{t}</span>
      ))}
    </div>
  );
}

export default function MemberProfileTab({ memberId }: { memberId: string }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('member.profile_edit');
  const canEditEmergency = hasPermission('member.emergency_edit');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = () => {
    setLoading(true);
    axios.get(`/members/${memberId}/profile`, { withCredentials: true })
      .then((res) => { setProfile(res.data); setError(''); })
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view this member's profile."
        : 'Could not load the profile.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [memberId]);

  const startEdit = () => {
    setForm({
      occupation: profile.occupation || '',
      membershipDate: profile.membershipDate ? String(profile.membershipDate).slice(0, 10) : '',
      skills: (profile.skills || []).join(', '),
      interests: (profile.interests || []).join(', '),
      serviceInterests: (profile.serviceInterests || []).join(', '),
      preferredChannels: profile.preferredChannels || [],
      emergencyContactName: profile.emergencyContact?.name || '',
      emergencyContactPhone: profile.emergencyContact?.phone || '',
      emergencyContactRelationship: profile.emergencyContact?.relationship || '',
    });
    setError('');
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body: any = {
      occupation: form.occupation,
      membershipDate: form.membershipDate || null,
      skills: csv(form.skills),
      interests: csv(form.interests),
      serviceInterests: csv(form.serviceInterests),
      preferredChannels: form.preferredChannels,
    };
    // Only send emergency fields when the user is allowed to change them (the server also enforces this).
    if (canEditEmergency && profile.emergencyContact) {
      body.emergencyContactName = form.emergencyContactName;
      body.emergencyContactPhone = form.emergencyContactPhone;
      body.emergencyContactRelationship = form.emergencyContactRelationship;
    }
    try {
      const res = await axios.put(`/members/${memberId}/profile`, body, { withCredentials: true });
      setProfile(res.data);
      setEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-10"><span className="spinner" /></div>;
  if (error && !profile) return <p className="py-6 text-sm text-slate-500">{error}</p>;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Engagement profile</h2>
        {canEdit && !editing && (
          <button onClick={startEdit} className="btn btn-secondary btn-sm">
            <PencilSquareIcon className="h-4 w-4" /> Edit
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">{error}</div>
      )}

      {editing ? (
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Occupation</label>
              <input className="input" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
            </div>
            <div>
              <label className="label">Membership date</label>
              <input type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={form.membershipDate}
                onChange={(e) => setForm({ ...form, membershipDate: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Skills (comma separated)</label>
              <input className="input" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Interests (comma separated)</label>
              <input className="input" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Service / volunteer interests (comma separated)</label>
              <input className="input" value={form.serviceInterests} onChange={(e) => setForm({ ...form, serviceInterests: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Preferred communication channels</label>
              <div className="flex flex-wrap gap-4 pt-1">
                {CHANNELS.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.preferredChannels.includes(c)}
                      onChange={(e) => setForm({
                        ...form,
                        preferredChannels: e.target.checked
                          ? [...form.preferredChannels, c]
                          : form.preferredChannels.filter((x: string) => x !== c),
                      })}
                    />
                    {c.replace('_', ' ')}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">Recorded as the member's preference. FEMS currently delivers in-app notifications only.</p>
            </div>
          </div>

          {canEditEmergency && profile.emergencyContact && (
            <div className="rounded-lg bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
              <h3 className="text-sm font-semibold text-amber-900">Emergency contact (restricted)</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} />
                </div>
                <div>
                  <label className="label">Relationship</label>
                  <input className="input" value={form.emergencyContactRelationship} onChange={(e) => setForm({ ...form, emergencyContactRelationship: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? <span className="spinner border-white" /> : 'Save profile'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="space-y-3">
          {row('Occupation', profile.occupation || '—')}
          {row('Membership date', profile.membershipDate ? new Date(profile.membershipDate).toLocaleDateString() : '—')}
          {row('Skills', <Tags items={profile.skills} />)}
          {row('Interests', <Tags items={profile.interests} />)}
          {row('Service interests', <Tags items={profile.serviceInterests} />)}
          {row('Preferred channels', <Tags items={profile.preferredChannels} />)}
          {profile.emergencyContact && (
            <div className="mt-4 rounded-lg bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
              <h3 className="mb-2 text-sm font-semibold text-amber-900">Emergency contact (restricted)</h3>
              <dl className="space-y-2">
                {row('Name', profile.emergencyContact.name || '—')}
                {row('Phone', profile.emergencyContact.phone || '—')}
                {row('Relationship', profile.emergencyContact.relationship || '—')}
              </dl>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
