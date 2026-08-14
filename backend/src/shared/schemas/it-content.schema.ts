import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentSchemaDocument = HydratedDocument<DocumentEntity>;
export type BackupDocument = HydratedDocument<Backup>;

export const FINANCE_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RESUBMITTED: 'RESUBMITTED',
  FINAL_APPROVED: 'FINAL_APPROVED',
  CANCELLED: 'CANCELLED',
} as const;

export const FINANCE_STATES = Object.values(FINANCE_STATUS);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class DocumentEntity {
  _id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  stored_filename: string;

  @Prop({ required: true, type: Number })
  file_size: number;

  @Prop({ required: true })
  mime_type: string;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploaded_by: Types.ObjectId;

  @Prop({ default: () => new Date() })
  uploaded_at: Date;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'DRAFT',
  })
  approval_status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  // Custom field for IT content: is it published website content?
  @Prop({ default: false })
  is_website_content: boolean;
}

export const DocumentEntitySchema = SchemaFactory.createForClass(DocumentEntity);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Backup {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop({ default: () => new Date() })
  created_at: Date;

  @Prop({ required: true })
  file_path: string;

  @Prop({ type: Number, required: true })
  file_size: number;

  @Prop({
    type: String,
    enum: ['cloud', 'local'],
    required: true,
  })
  storage_location: string;

  @Prop({
    type: String,
    enum: ['success', 'failed'],
    default: 'success',
  })
  status: string;

  @Prop({ default: false })
  is_incremental: boolean;

  @Prop({ default: false })
  is_safety_backup: boolean;

  @Prop()
  restored_from?: Types.ObjectId;
}

export const BackupSchema = SchemaFactory.createForClass(Backup);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Comment {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author_id: Types.ObjectId;

  @Prop({ required: true })
  content: string;

  @Prop({ type: String, required: true })
  entity_type: string;

  @Prop({ type: Types.ObjectId, required: true })
  entity_id: Types.ObjectId;

  @Prop({ default: false })
  is_internal: boolean;

  @Prop({ default: () => new Date() })
  created_at: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class LeadershipHistory {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ required: true })
  role_name: string; // admin, secretary, chairperson, etc.

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ default: () => new Date() })
  start_date: Date;

  @Prop()
  end_date?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assigned_by?: Types.ObjectId;
}

export const LeadershipHistorySchema = SchemaFactory.createForClass(LeadershipHistory);
