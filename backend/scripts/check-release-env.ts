import { assertProductionConfig } from '../src/config/security-config';

const env = { ...process.env, NODE_ENV: 'production' };
const warnings = assertProductionConfig(env);
for (const warning of warnings) console.warn(`[config] ${warning}`);
console.log('Backend release configuration accepted.');
