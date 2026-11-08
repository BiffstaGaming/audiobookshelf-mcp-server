/**
 * Fuzzy title/author matching used by abs_check_owned to decide whether a
 * suggested book is already in the library, despite differences like
 * subtitles, leading articles, punctuation, "(Unabridged)" or series suffixes.
 */

const NOISE = /\b(unabridged|abridged|a novel|novel|audiobook|book \d+|bk \d+)\b/g;

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([{].*?[)\]}]/g, ' ') // bracketed notes: (Unabridged), [Dramatized]
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title without subtitle ("Dune: Deluxe Edition" → "Dune"). */
export function mainTitle(title: string): string {
  const cut = title.split(/\s[:–—-]\s|:\s/)[0] ?? title;
  return cut.trim() || title;
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surnames are the most stable part of author names ("J.R.R. Tolkien" vs "J. R. R. Tolkien"). */
function surnames(authorField: string): Set<string> {
  const out = new Set<string>();
  for (const part of authorField.split(/,|&| and /i)) {
    const words = normaliseName(part)
      .split(' ')
      .filter((w) => w.length > 1);
    const last = words[words.length - 1];
    if (last) out.add(last);
  }
  return out;
}

export function authorsOverlap(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const sa = surnames(a);
  const sb = surnames(b);
  for (const s of sa) if (sb.has(s)) return true;
  return false;
}

export type MatchConfidence = 'exact' | 'likely' | 'possible';

export function scoreMatch(
  wanted: { title: string; author?: string },
  candidate: { title: string; subtitle?: string | null; author: string | null },
): MatchConfidence | null {
  const wFull = normaliseTitle(wanted.title);
  const wMain = normaliseTitle(mainTitle(wanted.title));
  const cFull = normaliseTitle(candidate.title);
  const cWithSub = candidate.subtitle ? normaliseTitle(`${candidate.title} ${candidate.subtitle}`) : cFull;
  const cMain = normaliseTitle(mainTitle(candidate.title));
  if (!wMain || !cMain) return null;

  let title: 'exact' | 'main' | 'contains' | null = null;
  if (wFull === cFull || wFull === cWithSub) title = 'exact';
  else if (wMain === cMain) title = 'main';
  else if ((wMain.length >= 4 && cFull.includes(wMain)) || (cMain.length >= 4 && wFull.includes(cMain)))
    title = 'contains';
  if (!title) return null;

  const author = authorsOverlap(wanted.author, candidate.author);
  if (author === false) return title === 'exact' ? 'possible' : null;
  if (title === 'exact') return author === true || author === null ? 'exact' : 'possible';
  if (title === 'main') return author === true ? 'exact' : 'likely';
  return author === true ? 'likely' : 'possible';
}

export const CONFIDENCE_RANK: Record<MatchConfidence, number> = { exact: 3, likely: 2, possible: 1 };
