import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Infer a series name from a comic title by stripping trailing volume / issue /
 * chapter / number tokens and parentheticals. Used to auto-group the Library
 * when a comic has no explicit `series` set.
 *
 * e.g. "Batman Vol. 3: The Court of Owls" -> "Batman"
 *      "One Piece ch. 1024 - Wano"          -> "One Piece"
 *      "Spy x Family 12"                    -> "Spy x Family"
 */
export function inferSeries(title: string): string {
  let t = title.trim();
  // Drop anything in parentheses / brackets.
  t = t.replace(/[([{][^\]})]*[)\]}]/g, ' ');
  // Remove explicit volume / chapter / issue markers and trailing numbers.
  t = t.replace(/\b(vol|volume|vol\.|ch|chap|chapter|issue|iss|no|num|number)\b\.?\s*#?\s*\d+/gi, ' ');
  // Remove a trailing standalone number (issue number) and a leading "#N".
  t = t.replace(/#\s*\d+/gi, ' ');
  t = t.replace(/\s+\d+\s*$/, ' ');
  // Collapse whitespace and trim.
  t = t.replace(/\s+/g, ' ').trim();
  // Fall back to the full title if inference left nothing useful.
  return t.length > 0 ? t : title.trim();
}
