import { MembershipEventType, MembershipStatus, Prisma } from '@prisma/client';

export interface HistoryInput {
  memberId: string;
  fellowshipId?: string | null;
  eventType: MembershipEventType;
  fromStatus?: MembershipStatus | null;
  toStatus?: MembershipStatus | null;
  departmentId?: string | null;
  relatedDepartmentId?: string | null;
  reason?: string | null;
  // null/undefined = a system-generated event (e.g. automatic graduation).
  recordedBy?: string | null;
  occurredAt?: Date;
}

// Pure row builder so every writer (members.service, approvals.service) produces identical rows and
// can put the history insert in the same $transaction as the change it records.
export function buildHistoryData(input: HistoryInput): Prisma.MembershipHistoryUncheckedCreateInput {
  return {
    member_id: input.memberId,
    fellowship_id: input.fellowshipId ?? null,
    event_type: input.eventType,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    department_id: input.departmentId ?? null,
    related_department_id: input.relatedDepartmentId ?? null,
    reason: input.reason ?? null,
    recorded_by: input.recordedBy ?? null,
    occurred_at: input.occurredAt ?? new Date(),
  };
}
