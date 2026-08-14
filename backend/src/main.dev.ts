import { MongoMemoryServer } from 'mongodb-memory-server';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;

  console.log(`MongoDB Memory Server started at: ${uri}`);

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
  });

  const configService = app.get(ConfigService);

  app.use(require('helmet')());
  app.use(require('cookie-parser')());
  app.useGlobalPipes(new (require('@nestjs/common').ValidationPipe)({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');

  // Seed data
  const seedRoles = require('./users/schemas/role.schema').seedRoles;
  const RoleModel = app.get('RoleModel');
  if (seedRoles && RoleModel) {
    await seedRoles(RoleModel).catch(console.error);
  }

  await app.listen(process.env.PORT || 3000);
  console.log(`Fellowship Management API running on port ${process.env.PORT || 3000}`);
}
bootstrap();
