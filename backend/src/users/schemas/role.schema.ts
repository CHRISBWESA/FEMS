import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true, collection: 'roles' })
export class Role {
  @Prop({ unique: true, required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ default: false })
  is_system_role: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

export async function seedRoles(model: Model<Role>) {
  const { ROLE_DEFINITIONS } = require('../shared/authorization/roles');
  for (const def of ROLE_DEFINITIONS) {
    const exists = await model.findOne({ name: def.name }).exec();
    if (!exists) {
      await model.create({
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        is_system_role: true,
      });
    }
  }
}
