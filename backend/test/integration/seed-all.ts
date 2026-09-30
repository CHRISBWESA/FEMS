import { randomUUID } from 'crypto';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { addToDepartment, makeActivity, makeMember, makeUser, uniq } from './harness';

export interface Seeded {
  label: string;
  id: string;
}

// One record of (almost) every kind of entity, all belonging to fellowship `f`. Used by the sweeps that need a real id of
// every type: with a real id a request reaches the handler's real code instead of being turned away with a 404.
export async function seedEverything(prisma: PrismaService, f: { id: string }, d: { id: string }) {
  const seeded: Seeded[] = [];
  const owner = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
  const member = await makeMember(prisma, { fellowshipId: f.id, name: 'Fuzz Person', userId: owner.id });
  await addToDepartment(prisma, member.id, d.id);
  const activity = await makeActivity(prisma, { fellowshipId: f.id, departmentId: d.id });
  seeded.push(
    { label: 'member', id: member.id },
    { label: 'user', id: owner.id },
    { label: 'department', id: d.id },
    { label: 'activity', id: activity.id },
    { label: 'fellowship', id: f.id },
  );
  const create = async (label: string, fn: () => Promise<{ id: string }>) => {
    try {
      seeded.push({ label, id: (await fn()).id });
    } catch (e: any) {
      console.warn(`seed skipped: ${label}: ${String(e.message).split('\n').slice(-2).join(' ').slice(0, 120)}`);
    }
  };
  await create('attendance', () => prisma.attendance.create({ data: { activity_id: activity.id, member_id: member.id, fellowship_id: f.id, recorded_by_name: 'Fuzz Person' } }));
  await create('notification', () => prisma.notification.create({ data: { recipient_user_id: owner.id, event_type: 'x', title: 'Private', message: 'Private', fellowship_id: f.id } }));
  await create('report', () => prisma.report.create({ data: { department_id: d.id, fellowship_id: f.id, title: 'A report', content: 'secret', submitted_by: owner.id } }));
  await create('document', () => prisma.documentEntity.create({ data: { title: 'Doc', filename: 'a.pdf', stored_filename: `s-${uniq()}`, file_size: 10, mime_type: 'application/pdf', fellowship_id: f.id, uploaded_by: owner.id } }));
  await create('deleted-record', () => prisma.deletedRecord.create({ data: { original_collection: 'members', original_record_id: randomUUID(), original_data: { full_name: 'Deleted Person' }, deleted_by: owner.id, restore_token: `t-${uniq()}${uniq()}` } }));
  await create('youth', () => prisma.youthProfile.create({ data: { fellowship_id: f.id, full_name: 'Young Person', date_of_birth: new Date('2012-01-01'), created_by: owner.id } }));
  await create('age-group', () => prisma.ageGroup.create({ data: { fellowship_id: f.id, name: `AG ${uniq()}`, min_age: 5, max_age: 12, created_by: owner.id } as any }));
  await create('asset-category', () => prisma.assetCategory.create({ data: { fellowship_id: f.id, name: `Cat ${uniq()}`, created_by: owner.id } }));
  await create('asset-location', () => prisma.assetLocation.create({ data: { fellowship_id: f.id, name: `Loc ${uniq()}`, created_by: owner.id } }));
  await create('asset', () => prisma.asset.create({ data: { fellowship_id: f.id, asset_tag: `AST-${uniq()}`, name: 'Speaker', created_by: owner.id } as any }));
  const opp = await prisma.serviceOpportunity.create({ data: { fellowship_id: f.id, title: 'Ushering', status: 'open', created_by: owner.id } });
  seeded.push({ label: 'opportunity', id: opp.id });
  const shift = await prisma.serviceShift.create({ data: { fellowship_id: f.id, opportunity_id: opp.id, starts_at: new Date(Date.now() + 5 * 86400000), ends_at: new Date(Date.now() + 5 * 86400000 + 7200000), capacity: 3, created_by: owner.id } });
  seeded.push({ label: 'shift', id: shift.id });
  await create('assignment', () => prisma.serviceAssignment.create({ data: { fellowship_id: f.id, shift_id: shift.id, member_id: member.id, status: 'confirmed', created_by: owner.id } }));
  await create('service-role', () => prisma.serviceRole.create({ data: { fellowship_id: f.id, name: `Role ${uniq()}`, created_by: owner.id } }));
  await create('member-group', () => prisma.memberGroup.create({ data: { fellowship_id: f.id, name: `Group ${uniq()}`, created_by: owner.id } as any }));
  await create('campaign', () => prisma.contributionCampaign.create({ data: { fellowship_id: f.id, name: `Camp ${uniq()}`, start_date: new Date(), created_by: owner.id } as any }));
  await create('finance-category', () => prisma.financeCategory.create({ data: { fellowship_id: f.id, name: `FC ${uniq()}`, kind: 'expense', created_by: owner.id } as any }));
  await create('contribution', () => prisma.contribution.create({ data: { member_id: member.id, fellowship_id: f.id, amount: 10, contribution_type: 'tithe', date: new Date(), recorded_by: owner.id } }));
  await create('expense', () => prisma.expense.create({ data: { fellowship_id: f.id, department_id: d.id, amount: 5, title: 'x', description: 'x', date: new Date(), recorded_by: owner.id } as any }));
  await create('financial-period', () => prisma.financialPeriod.create({ data: { fellowship_id: f.id, name: 'P', start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31'), created_by: owner.id } }));
  await create('income', () => prisma.incomeRecord.create({ data: { fellowship_id: f.id, amount: 7, date: new Date(), title: 'x', source: 'x', recorded_by: owner.id } as any }));
  await create('budget', () => prisma.budget.create({ data: { fellowship_id: f.id, department_id: d.id, fiscal_year: '2026', amount: 100, title: 'x', created_by: owner.id } as any }));
  await create('money-request', () => prisma.moneyRequest.create({ data: { fellowship_id: f.id, department_id: d.id, amount: 5, purpose: 'x', title: 'x', requester_id: owner.id } as any }));
  await create('support-grant', () => prisma.supportAccessGrant.create({ data: { fellowship_id: f.id, requested_by: owner.id, reason: 'x', scopes: ['tenant_config'], duration_minutes: 30 } }));
  await create('audit-entity', () => prisma.auditLog.create({ data: { user_id: owner.id, action: 'x', fellowship_id: f.id } }));
  return { seeded, owner, member, activity };
}
