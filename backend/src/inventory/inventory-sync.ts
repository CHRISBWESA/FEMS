import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Resource-management workflows. Their entity is an asset_transfers row or an asset_incidents row (disposals). */
export const INVENTORY_WORKFLOWS = ['asset_transfer_department', 'asset_transfer_fellowship', 'asset_disposal', 'asset_disposal_department', 'asset_disposal_major'];
const TRANSFERS = ['asset_transfer_department', 'asset_transfer_fellowship'];
const pending = (s: string) => ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(s);

/** Keeps the transfer / incident status in step with its approval (runs inside every decision's transaction). */
export async function syncInventoryStatus(tx: Tx, approval: any, status: string): Promise<void> {
  if (status === 'FINAL_APPROVED') return; // applyInventoryEffect completes it
  const where = { id: approval.entity_id, approval_workflow_id: approval.id };
  if (TRANSFERS.includes(approval.workflow_type)) {
    await tx.assetTransfer.updateMany({ where, data: { status: pending(status) ? 'PENDING' : status } });
  } else {
    await tx.assetIncident.updateMany({ where, data: { status: pending(status) ? 'PENDING_APPROVAL' : status } });
  }
}

async function history(tx: Tx, a: { fellowship_id: string | null; id: string }, eventType: string, actor: string, extra: Record<string, any> = {}) {
  await tx.assetHistory.create({ data: { fellowship_id: a.fellowship_id, asset_id: a.id, event_type: eventType as any, actor_id: actor, ...extra } });
}

/** The asset's status once nothing holds it: assigned to a department, or simply available. */
export async function restingStatus(tx: Tx, assetId: string): Promise<'assigned' | 'available'> {
  const open = await tx.assetAssignment.findUnique({ where: { active_key: assetId }, select: { id: true } });
  return open ? 'assigned' : 'available';
}

/**
 * What a FINAL approval does for resource workflows, inside the decision's transaction: the ownership change of an
 * approved transfer, or the write-off / disposal of an approved incident. Records are never deleted.
 */
export async function applyInventoryEffect(tx: Tx, approval: any, actorUserId?: string): Promise<boolean> {
  if (!INVENTORY_WORKFLOWS.includes(approval.workflow_type)) return false;
  const actor = actorUserId ?? approval.created_by;
  if (TRANSFERS.includes(approval.workflow_type)) {
    const t = await tx.assetTransfer.findUnique({ where: { id: approval.entity_id } });
    if (!t || t.approval_workflow_id !== approval.id) throw new BadRequestException('The transfer for this approval no longer exists.');
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: t.asset_id } });
    if (asset.ownership_type !== t.from_ownership || (asset.owning_department_id ?? null) !== (t.from_department_id ?? null)) {
      throw new ConflictException('The resource\'s ownership changed after this transfer was requested.');
    }
    if (['borrowed', 'checked_out', 'reserved', 'disposed', 'lost', 'retired'].includes(asset.status)) {
      throw new ConflictException(`The resource is ${asset.status.replace('_', ' ')} and cannot be transferred now.`);
    }
    const done = await tx.assetTransfer.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'COMPLETED', approved_by: actor, completed_at: new Date(), condition_after: t.condition_after ?? t.condition_before } });
    if (done.count !== 1) throw new ConflictException('This transfer is no longer pending.');
    // A department now owning it no longer needs an assignment; any open custody ends.
    await tx.assetAssignment.updateMany({ where: { asset_id: asset.id, active_key: asset.id }, data: { active_key: null, ended_at: new Date(), ended_by: actor, end_notes: 'Ownership transferred' } });
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        ownership_type: t.to_ownership, owning_department_id: t.to_department_id, assigned_department_id: null,
        ...(t.to_location_id ? { location_id: t.to_location_id } : {}), ...(t.to_custodian_id ? { custodian_member_id: t.to_custodian_id } : {}),
        status: asset.status === 'assigned' ? 'available' : asset.status,
      },
    });
    await history(tx, asset, 'ownership_transferred', actor, { from_department_id: t.from_department_id, to_department_id: t.to_department_id, from_value: t.from_ownership, to_value: t.to_ownership, note: `${t.transfer_number}: ${t.reason}` });
    await tx.auditLog.create({ data: { user_id: actor, action: 'resources.ownership_transferred', entity_type: 'asset', entity_id: asset.id, fellowship_id: asset.fellowship_id, new_value: { transfer: t.transfer_number, from: t.from_ownership, to: t.to_ownership, toDepartmentId: t.to_department_id } as any } });
    return true;
  }
  // disposal / write-off
  const inc = await tx.assetIncident.findUnique({ where: { id: approval.entity_id } });
  if (!inc || inc.approval_workflow_id !== approval.id) throw new BadRequestException('The incident for this approval no longer exists.');
  const asset = await tx.asset.findUniqueOrThrow({ where: { id: inc.asset_id } });
  const out = await tx.resourceRequest.count({ where: { asset_id: asset.id, status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] } } });
  if (out) throw new ConflictException('The resource is still issued to a borrower; record its return first.');
  const done = await tx.assetIncident.updateMany({ where: { id: inc.id, status: { in: ['PENDING_APPROVAL', 'OPEN'] } }, data: { status: 'CLOSED', outcome: inc.proposed_action === 'write_off' ? 'written_off' : 'disposed', closed_at: new Date(), closed_by: actor } });
  if (done.count !== 1) throw new ConflictException('This case is no longer open.');
  await tx.assetAssignment.updateMany({ where: { asset_id: asset.id, active_key: asset.id }, data: { active_key: null, ended_at: new Date(), ended_by: actor, end_notes: 'Resource disposed or written off' } });
  const writeOff = inc.proposed_action === 'write_off';
  await tx.asset.update({
    where: { id: asset.id },
    data: { status: writeOff ? 'lost' : 'disposed', disposed_at: new Date(), disposal_method: writeOff ? 'written off' : inc.disposal_method ?? 'disposed', retired_reason: inc.description.slice(0, 500), assigned_department_id: null },
  });
  await history(tx, asset, writeOff ? 'lost' : 'disposed', actor, { from_value: asset.status, to_value: writeOff ? 'lost' : 'disposed', note: `${inc.incident_number}: ${inc.description.slice(0, 300)}` });
  await tx.auditLog.create({ data: { user_id: actor, action: writeOff ? 'resources.written_off' : 'resources.disposed', entity_type: 'asset', entity_id: asset.id, fellowship_id: asset.fellowship_id, new_value: { incident: inc.incident_number } as any } });
  return true;
}
