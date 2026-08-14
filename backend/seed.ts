import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { ROLES, ROLE_DEFINITIONS } from './src/shared/authorization/roles';

async function seed() {
  const app = await NestFactory.createApplicationContext(
    (await import('./src/app.module')).AppModule,
    { logger: ['error', 'warn', 'log'] }
  );

  const configService = app.get(ConfigService);
  const mongoUri = configService.get('MONGODB_URI');

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB for seeding');

  // Clear existing data
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const col of collections) {
    await mongoose.connection.db.dropCollection(col.name);
  }
  console.log('Cleared database');

  // Seed Roles
  const rolesCollection = mongoose.connection.collection('roles');
  for (const roleDef of ROLE_DEFINITIONS) {
    await rolesCollection.insertOne(roleDef);
  }
  console.log('Seeded roles');

  // Seed Admin User
  const adminPassword = await bcrypt.hash('Admin@2024', 12);
  await mongoose.connection.collection('users').insertOne({
    email: 'admin@fellowship.com',
    password_hash: adminPassword,
    first_name: 'Admin',
    last_name: 'User',
    phone: '+1234567890',
    gender: 'other',
    roles: ['admin'],
    permissions: ROLE_DEFINITIONS.find(r => r.name === 'admin').permissions,
    is_active: true,
    must_change_password: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
  console.log('Seeded admin user: admin@fellowship.com / Admin@2024');

  // Seed Departments
  const departments = [
    { name: 'Choir', description: 'Music ministry' },
    { name: 'Praise & Worship', description: 'Worship ministry' },
    { name: 'IT', description: 'Information technology' },
    { name: 'Outreach', description: 'Community outreach' },
  ];
  for (const dept of departments) {
    await mongoose.connection.collection('departments').insertOne({
      name: dept.name,
      description: dept.description,
      is_active: true,
      leaders: [],
      custom_fields_schema: {},
      created_by: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  console.log('Seeded 4 departments');

  await app.close();
  await mongoose.disconnect();
  console.log('Seeding complete');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
