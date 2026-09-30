const { existsSync } = require('fs');
const { join } = require('path');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
  console.error('Production start requires NODE_ENV=production.');
  process.exit(1);
}
process.env.NODE_ENV = 'production';

const candidates = [join('dist', 'main.js'), join('dist', 'src', 'main.js')];
const entry = candidates.find(existsSync);
if (!entry) {
  console.error('No compiled API found. Run the backend build first.');
  process.exit(1);
}
require(join(process.cwd(), entry));
