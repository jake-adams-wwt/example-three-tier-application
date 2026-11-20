'use server';

import { revalidatePath } from 'next/cache';
import { validateTitle } from '@/lib/validation';

const API_URL = process.env.API_URL || 'http://localhost:3001';

export type Task = {
  id: number;
  title: string;
  completed: boolean;
  created_at: string;
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  fieldErrors?: { title?: string };
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Turns a failed API response into an ActionResult using the
// { error: { code, message, details } } format.
async function failure(res: Response): Promise<ActionResult> {
  let message = `Request failed (${res.status})`;
  const fieldErrors: { title?: string } = {};
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
    for (const d of body?.error?.details ?? []) {
      if (d.field === 'title') fieldErrors.title = d.message;
    }
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return { ok: false, error: message, fieldErrors };
}

async function send(path: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch {
    return null;
  }
}

const UNREACHABLE: ActionResult = { ok: false, error: 'Could not reach the server' };

async function finish(res: Response | null, allow404 = false): Promise<ActionResult> {
  if (!res) return UNREACHABLE;
  if (!res.ok && !(allow404 && res.status === 404)) return failure(res);
  revalidatePath('/');
  return { ok: true };
}

export async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/tasks`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function createTask(formData: FormData): Promise<ActionResult> {
  const title = String(formData.get('title') ?? '');
  const invalid = validateTitle(title);
  if (invalid) return { ok: false, fieldErrors: { title: invalid } };
  const res = await send('/tasks', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: title.trim() }),
  });
  return finish(res);
}

export async function updateTask(id: number, title: string): Promise<ActionResult> {
  const invalid = validateTitle(title);
  if (invalid) return { ok: false, fieldErrors: { title: invalid } };
  // PATCH changes only the title and leaves `completed` untouched.
  const res = await send(`/tasks/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: title.trim() }),
  });
  return finish(res);
}

export async function deleteTask(id: number): Promise<ActionResult> {
  // A 404 is reported as an error so the UI never hides a failed delete.
  const res = await send(`/tasks/${id}`, { method: 'DELETE' });
  return finish(res);
}

export async function toggleTask(id: number, completed: boolean): Promise<ActionResult> {
  const res = await send(`/tasks/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ completed }),
  });
  return finish(res);
}
