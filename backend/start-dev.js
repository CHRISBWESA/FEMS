require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function seedDatabase(mongoUri) {
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB for seeding');

  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const col of collections) {
    await mongoose.connection.db.dropCollection(col.name);
  }
  console.log('Cleared database');

  const adminPermissions = [
    'user.manage', 'user.view', 'user.password_reset',
    'member.register', 'member.edit', 'member.status_change', 'member.view_all', 'member.view_own_dept',
    'department.manage', 'department.leaders_manage', 'department.member_add', 'department.member_remove',
    'department.transfer',
    'activity.create', 'activity.edit', 'activity.cancel',
    'report.submit', 'report.review', 'report.final_approve',
    'finance.view', 'finance.contribution_record', 'finance.contribution_edit',
    'finance.expense_record', 'finance.expense_approve',
    'finance.budget_create', 'finance.budget_approve',
    'finance.money_request_create', 'finance.money_request_approve',
    'it.content_edit', 'it.content_publish_approve', 'it.content_delete_approve',
    'admin.settings', 'admin.backup', 'admin.restore', 'admin.recycle_bin', 'admin.audit_view', 'admin.impersonate',
    'recycle.restore', 'recycle.permanent_delete',
    'backup.create', 'backup.restore',
    'activity.attendance', 'activity.share_link',
  ];

  const adminPassword = await bcrypt.hash('Admin@2024', 12);
  await mongoose.connection.collection('users').insertOne({
    email: 'admin@fellowship.com',
    password_hash: adminPassword,
    first_name: 'Admin',
    last_name: 'User',
    phone: '+1234567890',
    gender: 'other',
    roles: ['admin'],
    permissions: adminPermissions,
    is_active: true,
    must_change_password: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
  console.log('Seeded admin user: admin@fellowship.com / Admin@2024');

  await mongoose.disconnect();
  console.log('Seeding complete');
}

(async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fellowship';
  console.log('Using MongoDB at:', mongoUri);

  try {
    await seedDatabase(mongoUri);

    const child = spawn('node', ['dist/src/main.js'], {
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      console.error('Failed to start server:', err.message);
    });

    child.on('exit', (code) => {
      console.log('Server exited with code:', code);
    });

    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      child.kill();
      process.exit(0);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
})();