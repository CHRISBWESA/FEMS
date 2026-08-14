import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ActivityDocument = HydratedDocument<Activity>;
export type AttendanceDocument = HydratedDocument<Attendance>;

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Activity {
  _id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Date })
  end_date?: Date;

  @Prop({
    type: String,
    enum: ['all_members', 'department', 'leaders', 'specific_group'],
    required: true,
  })
  audience_type: string;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop()
  specific_group?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Attendance {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Activity', required: true })
  activity_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Member' })
  member_id?: Types.ObjectId;

  @Prop()
  recorded_by_name?: string;

  @Prop({ default: () => new Date() })
  recorded_at: Date;

  @Prop({ default: true })
  is_confirmed: boolean;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Report {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Department', required: true })
  department_id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [Types.ObjectId], default: [] })
  attachments: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  submitted_by: Types.ObjectId;

  @Prop({ default: () => new Date() })
  submitted_at: Date;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'DRAFT',
  })
  status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Announcement {
  _id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({
    type: String,
    enum: ['all_members', 'department', 'leaders', 'specific_group'],
    default: 'all_members',
  })
  audience_type: string;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'],
    default: 'DRAFT',
  })
  status: string;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
