/** Shown while a page's code is being downloaded (the first time that page is opened). */
export default function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center ${fullScreen ? 'h-screen' : 'py-24'}`}>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-hairline border-t-primary" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
