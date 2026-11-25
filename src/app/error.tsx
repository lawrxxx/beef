"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="text-5xl">😵</div>
      <h1 className="mt-4 font-display text-2xl font-bold">something broke</h1>
      <p className="mt-1 text-muted">sorry about that. give it another go.</p>
      <button onClick={reset} className="btn-dark mt-6">try again</button>
    </div>
  );
}
