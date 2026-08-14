import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MemberDocument = HydratedDocument<Member>;

@Schema({ _id: false })
export class DepartmentMembership {
  @Prop({ type: Types.ObjectId, ref: 'Department', required: true })
  department_id: Types.ObjectId;

  @Prop({ default: () => new Date() })
  joined_at: Date;

  @Prop({ default: false })
  removed: boolean;

  @Prop()
  removed_at?: Date;

  @Prop()
  removal_approval_id?: Types.ObjectId;
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Member {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', unique: true, sparse: true })
  user_id?: Types.ObjectId;

  @Prop({ unique: true, required: true })
  member_code: string;

  @Prop({ required: true })
  full_name: string;

  @Prop()
  phone?: string;

  @Prop()
  email?: string;

  @Prop()
  gender?: string;

  @Prop()
  programme?: string;

  @Prop()
  year_of_study?: string;

  @Prop()
  university?: string;

  @Prop({ required: true })
  expected_graduation_year: number;

  @Prop({ required: true })
  expected_graduation_month: number;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'graduated'],
    default: 'active',
  })
  membership_status: string;

  @Prop()
  status_changed_by?: Types.ObjectId;

  @Prop()
  status_changed_at?: Date;

  @Prop({ type: [DepartmentMembership], default: [] })
  departments: DepartmentMembership[];

  @Prop({ type: Object })
  department_custom_fields?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const MemberSchema = SchemaFactory.createForClass(Member);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Department {
  _id: Types.ObjectId;

  @Prop({ unique: true, required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  is_active: boolean;

  @Prop({ type: [Object], default: [] })
  leaders: Array<{
    user_id: Types.ObjectId;
    role_in_department: string;
    start_date: Date;
    end_date?: Date;
  }>;

  @Prop({ type: Object })
  custom_fields_schema: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

export const DepartmentSchema = SchemaFactory.createForClass(Department);
