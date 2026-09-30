import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_DEFINITIONS } from '../src/shared/authorization/roles';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seeding is not allowed in production.');
  // Seed roles
  for (const roleDef of ROLE_DEFINITIONS) {
    await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {},
      create: {
        name: roleDef.name,
        description: roleDef.description,
        permissions: roleDef.permissions,
        is_system_role: true,
      },
    });
  }
  console.log('Seeded roles');

  // Seed admin user
  const adminEmail = 'admin@fellowship.com';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (typeof seedPassword !== 'string' || seedPassword.length < 12) {
      throw new Error('SEED_ADMIN_PASSWORD (at least 12 characters) is required to create the development administrator.');
    }
    const adminPassword = await bcrypt.hash(seedPassword, 12);
    const adminRole = ROLE_DEFINITIONS.find((r) => r.name === 'admin');
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password_hash: adminPassword,
        first_name: 'Admin',
        last_name: 'User',
        phone: '+1234567890',
        gender: 'other',
        roles: ['admin'],
        permissions: adminRole?.permissions || [],
        is_active: true,
        must_change_password: true,
      },
    });
    console.log('Seeded development administrator; the password must be changed at first login.');
  } else {
    console.log('Admin user already exists, skipping.');
  }

  // Departments are deliberately NOT seeded.
  //
  // A department belongs to a fellowship (that is what lets two congregations each have their own "Choir"), and
  // the only account this seed creates is the platform administrator, who has no fellowship. Seeding a global list
  // here would recreate precisely the orphan rows - departments no Secretary can ever see, edit or assign anybody
  // to - that the per-fellowship migration had to clean up. A fellowship's departments are created by its
  // Secretary once the fellowship exists.
  console.log('Seeding complete');
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
