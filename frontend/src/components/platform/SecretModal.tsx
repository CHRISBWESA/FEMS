import { useState } from 'react';
import { Modal } from '../finance/common';

// Shows a one-time credential. It is only held in memory: closing the dialog discards it, and the server never
// returns it again.
export default function SecretModal({ title, email, password, note, onClose }: { title: string; email: string; password: string; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* clipboard unavailable: the value is visible to copy by hand */ }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{note || 'Copy this temporary password now. It is shown only once and must be changed at first sign-in.'}</p>
        <div><label className="label">Account</label><p className="text-sm text-ink">{email}</p></div>
        <div>
          <label className="label">Temporary password</label>
          <div className="flex gap-2">
            <input readOnly className="input font-mono" value={password} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
        <button type="button" className="btn btn-primary w-full" onClick={onClose}>I have saved it</button>
      </div>
    </Modal>
  );
}
