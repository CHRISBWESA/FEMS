import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../shared/utils/uuid.util';
import { money, ZERO } from '../finance/accounting/ledger';
import { range } from '../finance/accounting/accounts.service';
import { Report, ReportColumn } from '../finance/accounting/exporters';
import { InventoryScopeService } from './inventory-scope.service';

export const RESOURCE_REPORTS: { key: string; title: string; centralOnly?: boolean }[] = [
  { key: 'central-inventory', title: 'Central inventory', centralOnly: true },
  { key: 'department-inventory', title: 'Department inventory' },
  { key: 'ownership', title: 'Asset ownership' },
  { key: 'allocations', title: 'Asset allocations' },
  { key: 'transfers', title: 'Resource transfers' },
  { key: 'borrowing', title: 'Borrowing and returns' },
  { key: 'overdue', title: 'Overdue resources' },
  { key: 'maintenance', title: 'Maintenance' },
  { key: 'damaged-lost', title: 'Damaged and lost assets' },
  { key: 'disposals', title: 'Disposals' },
  { key: 'stock', title: 'Consumable stock' },
  { key: 'low-stock', title: 'Low stock' },
  { key: 'acquisitions', title: 'Resource acquisitions' },
  { key: 'utilization', title: 'Resource utilization' },
];

const col = (key: string, label: string, isMoney = false): ReportColumn => ({ key, label, money: isMoney, align: isMoney ? 'right' : 'left' });
const OWNED = { ownership_type: { not: 'borrowed' as const } };

/** The resource position, dashboards and reports. Department leaders only ever see their own departments. */
@Injectable()
export class InventoryReportsService {
  constructor(private prisma: PrismaService, private scope: InventoryScopeService) {}

  async dashboard(user: any, q: any) {
    const where: any = await this.scope.listWhere(user, q?.departmentId);
    if (q?.ownership) where.ownership_type = q.ownership;
    if (q?.categoryId && isUuid(q.categoryId)) where.category_id = q.categoryId;
    if (q?.condition) where.condition = q.condition;
    if (q?.status) where.status = q.status;
    const r = range(q);
    if (r) where.acquisition_date = r;
    const fellowshipId = this.scope.fellowship(user);
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const central = this.scope.isCentralViewer(user);
    // Two rounds instead of four: everything that does not need the matching asset ids runs alongside the id lookup
    // (department summaries included), then the request/transfer/maintenance figures that do.
    const [ids, byOwnership, byStatus, damaged, acquisitions, disposals, depts, owned, held] = await Promise.all([
      this.prisma.asset.findMany({ where, select: { id: true } }).then((rows) => rows.map((x) => x.id)),
      this.prisma.asset.groupBy({ by: ['ownership_type'], where, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.asset.count({ where: { ...where, condition: { in: ['damaged', 'under_repair'] } } }),
      this.prisma.asset.findMany({ where: { ...where, ...OWNED }, orderBy: { created_at: 'desc' }, take: 8, select: { id: true, name: true, asset_tag: true, ownership_type: true, acquisition_date: true, created_at: true } }),
      this.prisma.asset.findMany({ where: { ...where, status: { in: ['disposed', 'lost'] } }, orderBy: { disposed_at: 'desc' }, take: 8, select: { id: true, name: true, asset_tag: true, status: true, disposed_at: true } }),
      // Department summaries (central officers only): what each department owns and holds.
      central ? this.prisma.department.findMany({ where: { fellowship_id: fellowshipId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
      central ? this.prisma.asset.groupBy({ by: ['owning_department_id'], where: { fellowship_id: fellowshipId, owning_department_id: { not: null }, ...OWNED, status: { notIn: ['disposed', 'lost', 'retired'] } }, _count: { _all: true } }) : Promise.resolve([]),
      central ? this.prisma.asset.groupBy({ by: ['assigned_department_id'], where: { fellowship_id: fellowshipId, assigned_department_id: { not: null } }, _count: { _all: true } }) : Promise.resolve([]),
    ]);
    const [pendingRequests, upcoming, overdue, transfers, lowStock, maintenanceOpen] = await Promise.all([
      this.prisma.resourceRequest.count({ where: { asset_id: { in: ids }, status: 'PENDING' } }),
      this.prisma.resourceRequest.count({ where: { asset_id: { in: ids }, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] }, needed_until: { gte: now, lte: week } } }),
      this.prisma.resourceRequest.count({ where: { asset_id: { in: ids }, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] }, needed_until: { lt: now } } }),
      this.prisma.assetTransfer.findMany({ where: { asset_id: { in: ids } }, orderBy: { created_at: 'desc' }, take: 8 }),
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "assets" WHERE "id" = ANY(${ids}::uuid[]) AND "is_consumable" AND "reorder_level" IS NOT NULL AND "quantity" <= "reorder_level"`,
      this.prisma.assetMaintenance.count({ where: { asset_id: { in: ids }, status: { in: ['reported', 'pending_review', 'approved', 'in_progress'] } } }),
    ]);
    const count = (rows: any[], key: string, v: string) => rows.find((x) => x[key] === v)?._count._all ?? 0;
    const departments = (depts as { id: string; name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
      owned: (owned as any[]).find((o) => o.owning_department_id === d.id)?._count._all ?? 0,
      assigned: (held as any[]).find((h) => h.assigned_department_id === d.id)?._count._all ?? 0,
    }));
    return {
      cards: {
        fellowshipOwned: count(byOwnership, 'ownership_type', 'fellowship'),
        departmentOwned: count(byOwnership, 'ownership_type', 'department'),
        donated: count(byOwnership, 'ownership_type', 'donated'),
        borrowedExternal: count(byOwnership, 'ownership_type', 'borrowed'),
        available: count(byStatus, 'status', 'available'),
        assigned: count(byStatus, 'status', 'assigned'),
        onLoan: count(byStatus, 'status', 'borrowed') + count(byStatus, 'status', 'checked_out'),
        damaged,
        lost: count(byStatus, 'status', 'lost'),
        inMaintenance: count(byStatus, 'status', 'in_maintenance'),
        disposed: count(byStatus, 'status', 'disposed'),
        pendingRequests, upcomingReturns: upcoming, overdueReturns: overdue, lowStock: Number(lowStock[0]?.n ?? 0), openMaintenance: maintenanceOpen,
      },
      recentTransfers: transfers, recentAcquisitions: acquisitions, recentDisposals: disposals, departments,
    };
  }

  list(user: any) {
    return RESOURCE_REPORTS.filter((r) => this.scope.isCentralViewer(user) || !r.centralOnly);
  }

  async build(user: any, key: string, q: any): Promise<Report> {
    const def = RESOURCE_REPORTS.find((r) => r.key === key);
    if (!def) throw new NotFoundException('Report not found');
    if (def.centralOnly && !this.scope.isCentralViewer(user)) throw new ForbiddenException('This report covers the whole fellowship.');
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = def.centralOnly ? 'central' : q?.departmentId;
    const where: any = await this.scope.listWhere(user, departmentId);
    if (q?.categoryId && isUuid(q.categoryId)) where.category_id = q.categoryId;
    if (q?.ownership) where.ownership_type = q.ownership;
    if (q?.condition) where.condition = q.condition;
    if (q?.status) where.status = q.status;
    if (q?.custodianMemberId && isUuid(q.custodianMemberId)) where.custodian_member_id = q.custodianMemberId;
    const r = range(q);
    const deptName = departmentId && departmentId !== 'central' ? (await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: fellowshipId }, select: { name: true } }))?.name : null;
    const base: Report = {
      key, title: def.title, generatedAt: new Date(), currency: (await this.prisma.financeSettings.findUnique({ where: { fellowship_id: fellowshipId }, select: { currency: true } }))?.currency ?? 'TZS',
      subtitle: `${deptName ?? (departmentId === 'central' ? 'Fellowship resources' : this.scope.isCentralViewer(user) ? 'All resources' : 'Your departments')}${r ? ` · ${r.gte?.toISOString().slice(0, 10) ?? 'start'} to ${r.lte?.toISOString().slice(0, 10) ?? 'today'}` : ''}`,
      summary: [], columns: [], rows: [],
    };
    const seeCost = this.scope.isCentralViewer(user) || !!deptName;
    const out = await this.compose(key, where, r, base, seeCost);
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'resources.report_generated', entity_type: 'report', fellowship_id: fellowshipId, new_value: { key, departmentId, format: q?.format ?? 'json' } as any } });
    return out;
  }

  private async names(ids: (string | null | undefined)[]) {
    const real = Array.from(new Set(ids.filter((x): x is string => !!x)));
    return new Map((await this.prisma.department.findMany({ where: { id: { in: real } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  }

  private async compose(key: string, where: any, r: any, rep: Report, seeCost: boolean): Promise<Report> {
    const inc = { category: { select: { name: true } }, location: { select: { name: true } }, owning_department: { select: { name: true } }, custodian: { select: { full_name: true } } };
    const assetRow = (a: any, depts: Map<string, string>) => ({
      tag: a.asset_tag, name: a.name, category: a.category?.name, ownership: a.ownership_type, owner: a.owning_department?.name ?? (a.ownership_type === 'borrowed' ? a.external_owner_name : 'Fellowship'),
      assigned: a.assigned_department_id ? depts.get(a.assigned_department_id) : '', location: a.location?.name, custodian: a.custodian?.full_name, condition: a.condition, status: a.status,
      quantity: a.quantity, value: seeCost ? money(a.acquisition_cost ?? a.estimated_value ?? 0) : '',
    });
    const assetCols = [col('tag', 'Tag'), col('name', 'Resource'), col('category', 'Category'), col('ownership', 'Ownership'), col('owner', 'Owner'), col('assigned', 'Assigned to'), col('location', 'Location'), col('custodian', 'Responsible'), col('condition', 'Condition'), col('status', 'Status'), col('quantity', 'Qty'), col('value', 'Value', true)];
    switch (key) {
      case 'central-inventory': case 'department-inventory': case 'ownership': {
        const assets = await this.prisma.asset.findMany({ where: { ...where, ...(key === 'ownership' ? {} : { is_consumable: false }), ...(r ? { acquisition_date: r } : {}) }, include: inc, orderBy: [{ ownership_type: 'asc' }, { name: 'asc' }], take: 5001 });
        const depts = await this.names(assets.map((a) => a.assigned_department_id));
        const owned = assets.filter((a) => a.ownership_type !== 'borrowed');
        const value = owned.reduce((s, a) => s.plus(a.acquisition_cost ?? a.estimated_value ?? 0), ZERO);
        const by = (t: string) => assets.filter((a) => a.ownership_type === t).length;
        return { ...rep, columns: assetCols, rows: assets.map((a) => assetRow(a, depts)),
          summary: [{ label: 'Owned resources', value: String(owned.length) }, { label: 'Fellowship / department / donated', value: `${by('fellowship')} / ${by('department')} / ${by('donated')}` }, { label: 'Borrowed from others (not owned)', value: String(by('borrowed')) }, ...(seeCost ? [{ label: 'Value of owned resources', value: value.toFixed(2) }] : [])],
          notes: ['Borrowed resources belong to others and are never counted in owned totals. An assignment to a department does not change ownership.'] };
      }
      case 'allocations': {
        const ids = (await this.prisma.asset.findMany({ where, select: { id: true } })).map((x) => x.id);
        const rows = await this.prisma.assetAssignment.findMany({ where: { asset_id: { in: ids }, ...(r ? { handed_over_at: r } : {}) }, orderBy: { handed_over_at: 'desc' }, take: 5001 });
        const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: rows.map((x) => x.asset_id) } }, select: { id: true, name: true, asset_tag: true } })).map((a) => [a.id, a]));
        const depts = await this.names(rows.map((x) => x.department_id));
        return { ...rep, columns: [col('tag', 'Tag'), col('name', 'Resource'), col('department', 'Department'), col('from', 'Handed over'), col('to', 'Ended'), col('cond', 'Condition at handover'), col('back', 'Condition at return')],
          rows: rows.map((x) => ({ tag: assets.get(x.asset_id)?.asset_tag, name: assets.get(x.asset_id)?.name, department: depts.get(x.department_id), from: x.handed_over_at, to: x.ended_at ?? 'current', cond: x.condition_at_handover, back: x.condition_at_return ?? '' })) };
      }
      case 'transfers': {
        const ids = (await this.prisma.asset.findMany({ where, select: { id: true } })).map((x) => x.id);
        const rows = await this.prisma.assetTransfer.findMany({ where: { asset_id: { in: ids }, ...(r ? { transfer_date: r } : {}) }, orderBy: { transfer_date: 'desc' }, take: 5001 });
        const depts = await this.names(rows.flatMap((x) => [x.from_department_id, x.to_department_id]));
        const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: rows.map((x) => x.asset_id) } }, select: { id: true, name: true, asset_tag: true } })).map((a) => [a.id, a]));
        return { ...rep, columns: [col('number', 'Transfer'), col('date', 'Date'), col('tag', 'Tag'), col('name', 'Resource'), col('kind', 'Kind'), col('from', 'From'), col('to', 'To'), col('status', 'Status'), col('reason', 'Reason')],
          rows: rows.map((x) => ({ number: x.transfer_number, date: x.transfer_date, tag: assets.get(x.asset_id)?.asset_tag, name: assets.get(x.asset_id)?.name, kind: x.kind, from: x.from_department_id ? depts.get(x.from_department_id) : x.from_ownership, to: x.to_department_id ? depts.get(x.to_department_id) : x.to_ownership, status: x.status, reason: x.reason })) };
      }
      case 'borrowing': case 'overdue': case 'utilization': {
        const ids = (await this.prisma.asset.findMany({ where, select: { id: true } })).map((x) => x.id);
        const rw: any = { asset_id: { in: ids } };
        if (key === 'overdue') { rw.status = { in: ['ISSUED', 'PARTIALLY_RETURNED'] }; rw.needed_until = { lt: new Date() }; }
        else if (r) rw.needed_from = r;
        const rows = await this.prisma.resourceRequest.findMany({ where: rw, orderBy: { needed_from: 'desc' }, take: 5001 });
        const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, asset_tag: true } })).map((a) => [a.id, a]));
        const depts = await this.names(rows.map((x) => x.department_id));
        if (key === 'utilization') {
          const used = new Map<string, { n: number; days: number }>();
          for (const x of rows.filter((y) => ['ISSUED', 'PARTIALLY_RETURNED', 'RETURNED'].includes(y.status))) {
            const u = used.get(x.asset_id) ?? { n: 0, days: 0 };
            u.n++; u.days += Math.max(1, Math.ceil(((x.returned_at ?? x.needed_until).getTime() - (x.issued_at ?? x.needed_from).getTime()) / 86_400_000));
            used.set(x.asset_id, u);
          }
          return { ...rep, columns: [col('tag', 'Tag'), col('name', 'Resource'), col('uses', 'Times used'), col('days', 'Days in use')],
            rows: ids.map((id) => ({ tag: assets.get(id)?.asset_tag, name: assets.get(id)?.name, uses: used.get(id)?.n ?? 0, days: used.get(id)?.days ?? 0 })).sort((a, b) => b.uses - a.uses) };
        }
        return { ...rep, columns: [col('number', 'Request'), col('tag', 'Tag'), col('name', 'Resource'), col('department', 'For'), col('from', 'From'), col('until', 'Due back'), col('qty', 'Qty'), col('returned', 'Returned'), col('status', 'Status'), col('cond', 'Condition back')],
          rows: rows.map((x) => ({ number: x.request_number, tag: assets.get(x.asset_id)?.asset_tag, name: assets.get(x.asset_id)?.name, department: x.department_id ? depts.get(x.department_id) : 'Fellowship', from: x.needed_from, until: x.needed_until, qty: x.quantity, returned: x.quantity_returned, status: x.status, cond: x.condition_in ?? '' })) };
      }
      case 'maintenance': {
        const ids = (await this.prisma.asset.findMany({ where, select: { id: true } })).map((x) => x.id);
        const rows = await this.prisma.assetMaintenance.findMany({ where: { asset_id: { in: ids }, ...(r ? { created_at: r } : {}) }, orderBy: { created_at: 'desc' }, take: 5001, include: { asset: { select: { name: true, asset_tag: true } } } });
        const total = rows.reduce((s, m) => s.plus(m.cost ?? 0), ZERO);
        return { ...rep, columns: [col('tag', 'Tag'), col('name', 'Resource'), col('reported', 'Reported'), col('issue', 'Issue'), col('technician', 'Technician'), col('status', 'Status'), col('est', 'Estimated', true), col('cost', 'Actual', true), col('expense', 'Finance expense')],
          rows: rows.map((m) => ({ tag: m.asset.asset_tag, name: m.asset.name, reported: m.created_at, issue: m.description, technician: m.technician ?? m.performed_by, status: m.status, est: seeCost && m.estimated_cost ? money(m.estimated_cost) : '', cost: seeCost && m.cost ? money(m.cost) : '', expense: m.expense_id ? 'linked' : '' })),
          ...(seeCost ? { totals: { cost: total.toFixed(2) } } : {}) };
      }
      case 'damaged-lost': case 'disposals': {
        const ids = (await this.prisma.asset.findMany({ where, select: { id: true } })).map((x) => x.id);
        const iw: any = { asset_id: { in: ids }, ...(r ? { created_at: r } : {}) };
        if (key === 'disposals') iw.proposed_action = { in: ['dispose', 'write_off'] };
        else iw.incident_type = { in: ['lost', 'damaged', 'missing', 'unusable'] };
        const rows = await this.prisma.assetIncident.findMany({ where: iw, orderBy: { created_at: 'desc' }, take: 5001 });
        const assets = new Map((await this.prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, asset_tag: true } })).map((a) => [a.id, a]));
        return { ...rep, columns: [col('number', 'Case'), col('date', 'Date'), col('tag', 'Tag'), col('name', 'Resource'), col('type', 'Type'), col('action', 'Proposed'), col('status', 'Status'), col('outcome', 'Outcome'), col('description', 'Description')],
          rows: rows.map((x) => ({ number: x.incident_number, date: x.occurred_at, tag: assets.get(x.asset_id)?.asset_tag, name: assets.get(x.asset_id)?.name, type: x.incident_type, action: x.proposed_action, status: x.status, outcome: x.outcome ?? '', description: x.description })),
          notes: ['Disposed and written-off resources stay on record with their ownership, acquisition and history.'] };
      }
      case 'stock': case 'low-stock': {
        const items = await this.prisma.asset.findMany({ where: { ...where, is_consumable: true }, include: inc, orderBy: { name: 'asc' }, take: 5001 });
        const list = key === 'low-stock' ? items.filter((i) => i.reorder_level !== null && i.quantity <= i.reorder_level) : items;
        return { ...rep, columns: [col('tag', 'Item'), col('name', 'Name'), col('category', 'Category'), col('owner', 'Store'), col('qty', 'In stock'), col('unit', 'Unit'), col('reorder', 'Reorder at'), col('where', 'Storage')],
          rows: list.map((i) => ({ tag: i.asset_tag, name: i.name, category: i.category?.name, owner: i.owning_department?.name ?? 'Fellowship', qty: i.quantity, unit: i.unit, reorder: i.reorder_level ?? '', where: i.storage_location ?? i.location?.name })) };
      }
      case 'acquisitions': {
        const assets = await this.prisma.asset.findMany({ where: { ...where, ...OWNED, ...(r ? { OR: [{ acquisition_date: r }, { acquisition_date: null, created_at: r }] } : {}) }, include: inc, orderBy: { created_at: 'desc' }, take: 5001 });
        const bought = assets.filter((a) => a.acquisition_method === 'purchase').reduce((s, a) => s.plus(a.acquisition_cost ?? 0), ZERO);
        const donated = assets.filter((a) => a.acquisition_method === 'donation').reduce((s, a) => s.plus(a.estimated_value ?? 0), ZERO);
        return { ...rep, columns: [col('tag', 'Tag'), col('name', 'Resource'), col('method', 'How acquired'), col('owner', 'Owner'), col('date', 'Date'), col('source', 'From'), col('value', 'Cost / value', true), col('expense', 'Finance record')],
          rows: assets.map((a) => ({ tag: a.asset_tag, name: a.name, method: a.acquisition_method, owner: a.owning_department?.name ?? 'Fellowship', date: a.acquisition_date ?? a.donation_date ?? a.created_at, source: a.donor_name ?? a.acquisition_source ?? '', value: seeCost ? money(a.acquisition_cost ?? a.estimated_value ?? 0) : '', expense: a.acquisition_expense_id ? 'linked' : a.acquisition_method === 'donation' ? 'donation (no cash)' : '' })),
          summary: seeCost ? [{ label: 'Purchased (cost)', value: bought.toFixed(2) }, { label: 'Donated (estimated value, not income)', value: donated.toFixed(2) }] : [] };
      }
    }
    throw new NotFoundException('Report not found');
  }
}

