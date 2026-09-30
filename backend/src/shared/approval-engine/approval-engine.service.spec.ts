import { ForbiddenException } from '@nestjs/common';
import { ApprovalEngineService } from './approval-engine.service';

function workflow(approverRole: string, approverUserId: string | null = null) {
  return {
    id: 'approval',
    current_stage: 0,
    steps: [{ stage_order: 0, approver_role: approverRole, approver_user_id: approverUserId, status: 'pending' }],
  };
}

function serviceFor(value: any) {
  const prisma = { approval: { findUnique: jest.fn().mockResolvedValue(value) } };
  return new ApprovalEngineService(prisma as any);
}

describe('approval role resolution', () => {
  it('allows an assistant secretary to act at a secretary stage', async () => {
    await expect(serviceFor(workflow('secretary')).getWorkflowForUser('approval', 'user', ['assistant_secretary'])).resolves.toBeTruthy();
  });

  it('does not let a department chair substitute for a department secretary', async () => {
    await expect(serviceFor(workflow('department_secretary')).getWorkflowForUser('approval', 'user', ['department_chairperson'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a designated approver to still hold the expected role', async () => {
    await expect(serviceFor(workflow('treasurer', 'designated')).getWorkflowForUser('approval', 'designated', ['ordinary_member'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(serviceFor(workflow('treasurer', 'designated')).getWorkflowForUser('approval', 'designated', ['treasurer'])).resolves.toBeTruthy();
  });
});

describe('entity status synchronization', () => {
  it('updates reports and documents only through their bound workflow', async () => {
    const service = serviceFor(workflow('secretary'));
    const tx = {
      report: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentEntity: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await (service as any).syncEntityStatus(tx, { id: 'workflow', entity_id: 'entity', workflow_type: 'report' }, 'APPROVED');
    await (service as any).syncEntityStatus(tx, { id: 'workflow', entity_id: 'entity', workflow_type: 'it_content' }, 'REJECTED');
    expect(tx.report.updateMany).toHaveBeenCalledWith({
      where: { id: 'entity', approval_workflow_id: 'workflow' },
      data: { approval_status: 'UNDER_REVIEW' },
    });
    expect(tx.documentEntity.updateMany).toHaveBeenCalledWith({
      where: { id: 'entity', approval_workflow_id: 'workflow' },
      data: { approval_status: 'REJECTED' },
    });
  });
});
