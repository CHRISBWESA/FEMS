import { Link } from 'react-router-dom';
import { Empty } from '../components/finance/common';

// Shown for any URL that matches no route. Without this the router rendered a blank <main>, so a mistyped or
// retired link looked like a broken application rather than a missing page.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card text-center">
        <p className="text-3xl font-semibold tracking-tight text-ink">Page not found</p>
        <p className="mt-2 text-sm text-ink-muted">
          That address does not match any page in the application. It may have been renamed, or the link may be incomplete.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link to="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          <Link to="/profile" className="btn btn-secondary">My profile</Link>
        </div>
      </div>
      <div className="mt-4">
        <Empty text="If you followed a link inside FEMS, this is a defect - please report the address you used." />
      </div>
    </div>
  );
}
