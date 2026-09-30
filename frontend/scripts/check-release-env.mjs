const url = process.env.VITE_API_BASE_URL;
const problems = [];
if (!url) {
  problems.push('VITE_API_BASE_URL must be provided explicitly for a release build.');
} else {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    problems.push('VITE_API_BASE_URL must be a valid URL.');
  }
  if (parsed) {
    if (parsed.protocol !== 'https:') problems.push('VITE_API_BASE_URL must use https.');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) problems.push('VITE_API_BASE_URL must not contain credentials, a query, or a fragment.');
    if (/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(parsed.hostname)) problems.push('VITE_API_BASE_URL must not point at the local machine.');
    if (parsed.pathname !== '/api/v1') problems.push('VITE_API_BASE_URL path must be exactly /api/v1.');
  }
}
if (problems.length) {
  console.error('Release build refused:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('Frontend release configuration accepted.');
