import { useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import { Button, Field, Input, PageHeader, Select, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { errMsg, FormModal, label, useLoad } from '../fin/common';

import { RESOURCE_CENTRAL_ROLES as CENTRAL_ROLES } from '../lib/area-roles';
export { CENTRAL_ROLES };

export const CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'damaged', 'under_repair'];
const conditionOptions = CONDITIONS.map((c) => ({ value: c, label: label(c) }));

export interface InvScope {
  departmentId: string | null;
  departmentName?: string;
  roles: string[];
  leaderRole?: 'department_chairperson' | 'department_secretary' | null;
}

/**
 * Resources: one page listing the fellowship's (or one department's) resources, with Add and Edit. The Treasurer
 * manages the fellowship's resources; a department's leaders manage their department's own.
 */
export function ResourcesPage({ scope }: { scope: InvScope }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ limit: '200', ...(search ? { search } : {}), ...(scope.departmentId ? { departmentId: scope.departmentId } : {}) }).toString();
  const list = useLoad<any>(`/inventory/assets?${qs}`, [qs]);
  const cats = useLoad<any[]>('/inventory/categories', []);
  const locs = useLoad<any[]>('/inventory/locations', []);
  const [form, setForm] = useState<any>(null);
  const canManage = scope.departmentId ? !!scope.leaderRole : scope.roles.includes('treasurer');
  const rows = (list.data?.data ?? []).filter((r: any) => !['disposed', 'lost'].includes(r.status));

  const addOption = async (kind: 'categories' | 'locations', field: 'categoryId' | 'locationId') => {
    const name = window.prompt(kind === 'categories' ? 'Name of the new category' : 'Name of the new location');
    if (!name?.trim()) return;
    try {
      const r = (await axios.post(`/inventory/${kind}`, { name: name.trim() }, { withCredentials: true })).data;
      (kind === 'categories' ? cats : locs).reload();
      setForm((f: any) => ({ ...f, [field]: r.id }));
    } catch (e) { toast.push('error', errMsg(e, 'Could not add it.')); }
  };

  const open = (r?: any) => setForm(r
    ? { id: r.id, name: r.name, categoryId: r.category_id ?? r.category?.id ?? '', locationId: r.location_id ?? r.location?.id ?? '', quantity: String(r.quantity ?? 1), condition: r.condition ?? 'good', description: r.description ?? '' }
    : { name: '', categoryId: '', locationId: '', quantity: '1', condition: 'good', description: '' });

  const save = async () => {
    const body: any = { name: form.name, categoryId: form.categoryId || null, locationId: form.locationId || null, quantity: Number(form.quantity || 1), condition: form.condition, description: form.description || undefined };
    if (form.id) {
      await axios.put(`/inventory/assets/${form.id}`, body, { withCredentials: true });
      toast.push('success', 'Resource saved');
    } else {
      await axios.post('/inventory/assets', { ...body, ownershipType: scope.departmentId ? 'department' : 'fellowship', departmentId: scope.departmentId ?? undefined }, { withCredentials: true });
      toast.push('success', 'Resource added');
    }
    list.reload();
  };

  const options = (data?: any[]) => (data ?? []).filter((c) => c.is_active !== false).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader eyebrow={scope.departmentName} title="Resources"
        actions={canManage ? <Button variant="primary" onClick={() => open()}><PlusIcon className="h-4 w-4" /> Add resource</Button> : undefined} />
      <DataTable rows={rows} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        clientPaging pageSize={50}
        search={{ value: search, onChange: setSearch, placeholder: 'Search by name' }}
        onRowClick={canManage ? (r: any) => open(r) : undefined} rowClickLabel={(r: any) => `Edit ${r.name}`}
        empty={{ title: 'No resources yet', description: canManage ? 'Use "Add resource" to list the first one.' : undefined }}
        columns={[
          { key: 'n', header: 'Resource', render: (r: any) => <span className="font-medium text-ink">{r.name}</span>, priority: 'primary' },
          { key: 'c', header: 'Category', render: (r: any) => r.category?.name ?? '—' },
          { key: 'q', header: 'Quantity', align: 'right', tabular: true, render: (r: any) => r.quantity },
          { key: 'k', header: 'Condition', render: (r: any) => label(r.condition) },
          { key: 'l', header: 'Location', render: (r: any) => r.location?.name ?? '—', priority: 'meta' },
          ...(scope.departmentId ? [] : [{ key: 'o', header: 'Owner', render: (r: any) => r.ownerLabel ?? '—', priority: 'meta' as const }]),
        ]}
        rowActions={canManage ? (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button> : undefined} />

      <FormModal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit resource' : 'Add resource'} width="lg" onSubmit={save}>
        {form && (
          <>
            <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Plastic chairs, Projector, Keyboard" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <div className="flex gap-2">
                  <Select className="flex-1" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} placeholder="None" options={options(cats.data ?? undefined)} />
                  {canManage && !scope.departmentId && <Button type="button" size="sm" onClick={() => addOption('categories', 'categoryId')}>New</Button>}
                </div>
              </Field>
              <Field label="Location">
                <div className="flex gap-2">
                  <Select className="flex-1" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} placeholder="None" options={options(locs.data ?? undefined)} />
                  {canManage && !scope.departmentId && <Button type="button" size="sm" onClick={() => addOption('locations', 'locationId')}>New</Button>}
                </div>
              </Field>
              <Field label="Quantity" required><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
              <Field label="Condition"><Select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} options={conditionOptions} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </>
        )}
      </FormModal>
    </div>
  );
}

/** /inventory: the fellowship's resources. */
export default function InventoryArea() {
  const { user } = useAuth();
  return <ResourcesPage scope={{ departmentId: null, roles: user?.roles ?? [] }} />;
}
