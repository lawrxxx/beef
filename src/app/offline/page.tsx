export const metadata = { title: "offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center text-center">
      <div className="text-5xl">📡</div>
      <h1 className="mt-4 font-display text-2xl font-bold">you're offline</h1>
      <p className="mt-2 max-w-xs text-[15px] text-muted">beef needs a connection for prices and duels. your data is safe. we'll pick up where you left off.</p>
      <a href="/" className="btn-dark mt-6">try again</a>
    </div>
  );
}
