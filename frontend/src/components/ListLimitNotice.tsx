// Lists the server bounds (see the X-Total-Count header) say so instead of silently hiding rows.
export default function ListLimitNotice({ shown, total, noun }: { shown: number; total: number | null; noun: string }) {
  if (total === null || total <= shown) return null;
  return (
    <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20" role="status">
      Showing the first {shown} of {total} {noun}. Use the filters to narrow the list down.
    </div>
  );
}
