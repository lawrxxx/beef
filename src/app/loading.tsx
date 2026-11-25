export default function Loading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center gap-3"><div className="skeleton h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><div className="skeleton h-3 w-1/3" /><div className="skeleton h-3 w-1/5" /></div></div>
          <div className="skeleton mt-4 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
