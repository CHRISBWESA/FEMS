import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApprovalDocument = HydratedDocument<Approval>;

export type ApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMITTED'
  | 'FINAL_APPROVED'
  | 'CANCELLED';

@Schema({ _id: false })
export class ApprovalStep {
  @Prop({ required: true })
  stage_order: number;

  @Prop({ required: true })
  approver_role: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approver_user_id?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected', 'skipped'],
    default: 'pending',
  })
  status: string;

  @Prop()
  comment?: string;

  @Prop()
  acted_at?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  acted_by?: Types.ObjectId;
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Approval {
  _id: Types.ObjectId;

  @Prop({ required: true })
  workflow_type: string;

  @Prop({ required: true })
  entity_id: Types.ObjectId;

  @Prop({ required: true })
  entity_type: string;

  @Prop({ type: Number, default: 0 })
  current_stage: number;

  @Prop({
    type: String,
    enum: [
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'RESUBMITTED',
      'FINAL_APPROVED',
      'CANCELLED',
    ],
    default: 'DRAFT',
  })
  status: ApprovalStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop({ type: [ApprovalStep], default: [] })
  steps: ApprovalStep[];

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ApprovalSchema = SchemaFactory.createForClass(Approval);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Notification {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient_user_id: Types.ObjectId;

  @Prop({ required: true })
  event_type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop()
  entity_type?: string;

  @Prop({ type: Types.ObjectId })
  entity_id?: Types.ObjectId;

  @Prop({ default: false })
  is_read: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class AuditLog {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  user_id?: Types.ObjectId;

  @Prop({ required: true })
  action: string;

  @Prop()
  entity_type?: string;

  @Prop({ type: Types.ObjectId })
  entity_id?: Types.ObjectId;

  @Prop({ default: () => new Date() })
  timestamp: Date;

  @Prop({ type: Object })
  old_value?: Record<string, unknown>;

  @Prop({ type: Object })
  new_value?: Record<string, unknown>;

  @Prop()
  ip_address?: string;

  @Prop()
  device_info?: string;

  @Prop({ type: Object })
  approval_info?: Record<string, unknown>;

  @Prop()
  comment?: string;

  @Prop({ type: Types.ObjectId })
  impersonation_session_id?: Types.ObjectId;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class ImpersonationSession {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  admin_user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  target_user_id: Types.ObjectId;

  @Prop({ required: true })
  approval_token: string;

  @Prop({
    type: String,
    enum: ['requested', 'approved', 'active', 'expired', 'cancelled'],
    default: 'requested',
  })
  status: string;

  @Prop({ default: () => new Date() })
  requested_at: Date;

  @Prop()
  approved_at?: Date;

  @Prop()
  started_at?: Date;

  @Prop()
  expires_at?: Date;

  @Prop()
  ended_at?: Date;
}

export const ImpersonationSessionSchema =
  SchemaFactory.createForClass(ImpersonationSession);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class DeletedRecord {
  _id: Types.ObjectId;

  @Prop({ required: true })
  original_collection: string;

  @Prop({ required: true })
  original_record_id: Types.ObjectId;

  @Prop({ type: Object, required: true })
  original_data: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  deleted_by: Types.ObjectId;

  @Prop({ default: () => new Date() })
  deleted_at: Date;

  @Prop({ unique: true })
  restore_token: string;
}

export const DeletedRecordSchema = SchemaFactory.createForClass(DeletedRecord);
