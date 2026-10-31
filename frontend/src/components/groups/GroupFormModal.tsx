import { useEffect, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Field, Input, Modal, Switch, Textarea } from '../ui';

export interface GroupFormValues {
  id?: string;
  name: string;
  description: string | null;
  isActive?: boolean;
}

/** Creates a group, or edits one when `group` is given. Calls `onSaved` with the saved group. */
export default function GroupFormModal({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  group?: GroupFormValues | null;
  onClose: () => void;
  onSaved: (saved: { id: string; name: string }) => void;
}) {
  const editing = !!group?.id;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setIsActive(group?.isActive ?? true);
    setError('');
  }, [open, group]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a group name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim() || null, ...(editing ? { isActive } : {}) };
      const res = editing
        ? await axios.put(`/member-groups/${group!.id}`, body, { withCredentials: true })
        : await axios.post('/member-groups', body, { withCredentials: true });
      onSaved(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || (editing ? 'Could not save the group.' : 'Could not create the group.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit group' : 'New group'}
      description={editing ? undefined : 'After creating the group you can add members and appoint its leaders.'}
      footer={
        <>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="group-form" variant="primary" loading={saving}>
            {editing ? 'Save changes' : 'Create group'}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Group name" required hint="Must be different from every other group in the fellowship.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="Description" hint="Optional. Up to 300 characters.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        {editing && (
          <Switch
            label="Active"
            description="Inactive groups stay on record but are shown as inactive."
            checked={isActive}
            onChange={setIsActive}
          />
        )}
      </form>
    </Modal>
  );
}
