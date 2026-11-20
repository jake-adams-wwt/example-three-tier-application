'use client';

import { useActionState } from 'react';
import { deleteTask, type ActionResult } from '../actions';
import { ErrorMessage } from './ErrorMessage';

export function DeleteButton({ id, title }: { id: number; title: string }) {
  const [result, action, pending] = useActionState<ActionResult | null>(
    () => deleteTask(id),
    null,
  );
  const errorId = `delete-error-${id}`;

  return (
    <form action={action} className="flex flex-col items-end">
      <button
        type="submit"
        disabled={pending}
        aria-label={`Delete ${title}`}
        aria-describedby={result?.ok === false ? errorId : undefined}
        className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-1 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
      >
        Delete
      </button>
      {result?.ok === false && <ErrorMessage id={errorId} message={result.error} />}
    </form>
  );
}
