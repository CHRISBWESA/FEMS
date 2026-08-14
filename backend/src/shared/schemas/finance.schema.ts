import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ContributionDocument = HydratedDocument<Contribution>;
export type ExpenseDocument = HydratedDocument<Expense>;
export type BudgetDocument = HydratedDocument<Budget>;
export type MoneyRequestDocument = HydratedDocument<MoneyRequest>;

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Contribution {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Member', required: true })
  member_id: Types.ObjectId;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ required: true })
  contribution_type: string;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recorded_by: Types.ObjectId;

  @Prop({ default: () => new Date() })
  recorded_at: Date;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'FINAL_APPROVED',
  })
  approval_status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ContributionSchema = SchemaFactory.createForClass(Contribution);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Expense {
  _id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recorded_by: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'DRAFT',
  })
  approval_status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Budget {
  _id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ required: true })
  fiscal_year: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'DRAFT',
  })
  approval_status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class MoneyRequest {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requester_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  department_id?: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ required: true })
  purpose: string;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'FINAL_APPROVED', 'CANCELLED'],
    default: 'DRAFT',
  })
  approval_status: string;

  @Prop({ type: Types.ObjectId })
  approval_workflow_id?: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const MoneyRequestSchema = SchemaFactory.createForClass(MoneyRequest);
