import { useState } from 'react';
import { ErrorBox, Modal, errMsg } from '../finance/common';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'select' | 'textarea' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: string;
}

// A small declarative form dialog used by the resources screens. `onSubmit` receives the raw values;
// the caller maps them to an API payload and the server remains the source of truth for validation.
export default function FormModal({
  title, fields, initial = {}, submitLabel = 'Save', description, onSubmit, onClose,
}: {
  title: string;
  fields: Field[];
  initial?: Record<string, any>;
  submitLabel?: string;
  description?: string;
  onSubmit: (values: Record<string, any>) => Promise<any>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const v: Record<string, any> = {};
    fields.forEach((f) => { v[f.name] = initial[f.name] ?? (f.type === 'checkbox' ? false : ''); });
    return v;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSubmit(values);
      onClose();
    } catch (err: any) {
      setError(errMsg(err, 'Something went wrong'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {description && <p className="text-sm text-slate-600">{description}</p>}
        <ErrorBox text={error} />
        {fields.map((f) => (
          <div key={f.name}>
            {f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />
                {f.label}
              </label>
            ) : (
              <>
                <label className="label">{f.label}{f.required ? ' *' : ''}</label>
                {f.type === 'select' ? (
                  <select className="select" required={f.required} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea className="input" rows={3} required={f.required} placeholder={f.placeholder} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                ) : (
                  <input
                    className="input" type={f.type || 'text'} required={f.required} placeholder={f.placeholder} min={f.min} max={f.max}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                )}
              </>
            )}
            {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
          </div>
        ))}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn btn-primary flex-1">{saving ? <span className="spinner border-white" /> : submitLabel}</button>
          <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
