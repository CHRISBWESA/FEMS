require('dotenv').config();
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

if (process.env.NODE_ENV === 'production') {
  console.error('start-dev.js refuses to run in production.');
  process.exit(1);
}

const candidates = [join('dist', 'main.js'), join('dist', 'src', 'main.js')];
const entry = candidates.find(existsSync);
if (!entry) {
  console.error('No compiled API found. Run "npm run build" first.');
  process.exit(1);
}

const child = spawn(process.execPath, [entry], { env: process.env, stdio: 'inherit' });
child.on('error', () => {
  console.error('The development API process could not start.');
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
