import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditLog, AuditLogSchema } from './shared/schemas/system.schema';
import { Notification, NotificationSchema } from './shared/schemas/system.schema';
import { Approval, ApprovalSchema } from './shared/schemas/system.schema';
import { ImpersonationSession, ImpersonationSessionSchema } from './shared/schemas/system.schema';
import { DeletedRecord, DeletedRecordSchema } from './shared/schemas/system.schema';
import { User, UserSchema } from './users/schemas/user.schema';
import { Role, RoleSchema } from './users/schemas/role.schema';
import { Member, MemberSchema } from './shared/schemas/members-departments.schema';
import { Department, DepartmentSchema } from './shared/schemas/members-departments.schema';
import { Programme, ProgrammeSchema } from './programmes/programmes.schema';
import { Activity, ActivitySchema } from './shared/schemas/activities-reports.schema';
import { Attendance, AttendanceSchema } from './shared/schemas/activities-reports.schema';
import { Report, ReportSchema } from './shared/schemas/activities-reports.schema';
import { Announcement, AnnouncementSchema } from './shared/schemas/activities-reports.schema';
import { Contribution, ContributionSchema } from './shared/schemas/finance.schema';
import { Expense, ExpenseSchema } from './shared/schemas/finance.schema';
import { Budget, BudgetSchema } from './shared/schemas/finance.schema';
import { MoneyRequest, MoneyRequestSchema } from './shared/schemas/finance.schema';
import { Comment, CommentSchema } from './shared/schemas/it-content.schema';
import { LeadershipHistory, LeadershipHistorySchema } from './shared/schemas/it-content.schema';
import { DocumentEntity, DocumentEntitySchema } from './shared/schemas/it-content.schema';
import { Backup, BackupSchema } from './shared/schemas/it-content.schema';

const SCHEMA_FOR_FEATURE = MongooseModule.forFeature([
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: Approval.name, schema: ApprovalSchema },
  { name: ImpersonationSession.name, schema: ImpersonationSessionSchema },
  { name: DeletedRecord.name, schema: DeletedRecordSchema },
  { name: User.name, schema: UserSchema },
  { name: Role.name, schema: RoleSchema },
  { name: Member.name, schema: MemberSchema },
  { name: Department.name, schema: DepartmentSchema },
  { name: Programme.name, schema: ProgrammeSchema },
  { name: Activity.name, schema: ActivitySchema },
  { name: Attendance.name, schema: AttendanceSchema },
  { name: Report.name, schema: ReportSchema },
  { name: Announcement.name, schema: AnnouncementSchema },
  { name: Contribution.name, schema: ContributionSchema },
  { name: Expense.name, schema: ExpenseSchema },
  { name: Budget.name, schema: BudgetSchema },
  { name: MoneyRequest.name, schema: MoneyRequestSchema },
  { name: Comment.name, schema: CommentSchema },
  { name: LeadershipHistory.name, schema: LeadershipHistorySchema },
  { name: DocumentEntity.name, schema: DocumentEntitySchema },
  { name: Backup.name, schema: BackupSchema },
]);

@Global()
@Module({
  imports: [SCHEMA_FOR_FEATURE],
  exports: [SCHEMA_FOR_FEATURE],
})
export class ModelsModule {}
