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
/**
 * Extract a sortable chapter number from a chapter label.
 *
 * Manga sources (especially volume-based ones like "Overgeared (Volume)")
 * return chapter labels such as "Vol. 1 Chapter 10", "Ch. 3", "1", or even
 * non-numeric oneshots. A naive `parseFloat("Vol. 1 Chapter 10")` yields NaN,
 * which collapses every chapter to the same sort bucket and breaks Next/Prev
 * ordering. This finds the LAST number in the string (the chapter number),
 * falling back to the first number, then to +Infinity for unnumbered entries.
 */
export function parseChapterNumber(chapter: string | null | undefined, title?: string | null): number {
  const text = (chapter ?? title ?? '').toString();
  if (!text.trim()) return Number.POSITIVE_INFINITY;
  // Prefer the last number in the string ("Vol. 1 Chapter 10" -> 10).
  const all = text.match(/\d+(\.\d+)?/g);
  if (all && all.length > 0) {
    const n = parseFloat(all[all.length - 1]);
    if (Number.isFinite(n)) return n;
  }
  return Number.POSITIVE_INFINITY;
}

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
