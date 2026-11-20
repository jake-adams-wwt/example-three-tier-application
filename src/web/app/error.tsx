'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 py-16 px-4">
      <div className="max-w-lg mx-auto text-center">
        <p role="alert" className="text-red-600 mb-4">
          Something went wrong: {error.message}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-50 px-5 py-2 font-medium text-white dark:text-zinc-900"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
