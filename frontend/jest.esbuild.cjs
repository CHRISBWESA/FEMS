// Minimal TypeScript transform for Jest using esbuild (already present via Vite): no extra toolchain to maintain.
const esbuild = require('esbuild');

module.exports = {
  process(source, filename) {
    const { code } = esbuild.transformSync(source, {
      loader: filename.endsWith('x') ? 'tsx' : 'ts',
      format: 'cjs',
      target: 'es2020',
      sourcemap: 'inline',
      sourcefile: filename,
    });
    return { code };
  },
};
