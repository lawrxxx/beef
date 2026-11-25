import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="text-5xl">🥩</div>
      <h1 className="mt-4 font-display text-2xl font-bold">nothing to see here</h1>
      <p className="mt-1 text-muted">this page doesn't exist, or it moved.</p>
      <Link href="/" className="btn-dark mt-6">back home</Link>
    </div>
  );
}
