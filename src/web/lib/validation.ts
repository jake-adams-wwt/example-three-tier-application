// Mirrors the API's title rules (src/api/validation.js).
export const MAX_TITLE_LENGTH = 500;

/** Returns an error message, or null when the title is valid. */
export function validateTitle(title: unknown): string | null {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return 'Title must not be empty';
  }
  if (title.trim().length > MAX_TITLE_LENGTH) {
    return `Title must be at most ${MAX_TITLE_LENGTH} characters`;
  }
  return null;
}
