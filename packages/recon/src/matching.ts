/**
 * Three-way reconciliation (Phase 3, docs/ARCHITECTURE.md §"Pillar 1 —
 * Reconciliation"). `reconcile` matches a bank feed against posted general-ledger
 * cash lines and, where possible, a supporting source document — then surfaces
 * every discrepancy as a typed exception.
 *
 * The function is pure, deterministic, and total: it never performs I/O, never
 * uses randomness or floats (money stays in integer minor units), and never
 * throws on malformed input. An unparseable date simply fails to match (it is
 * never a valid candidate) and is reported through the ordinary UNMATCHED_*
 * channels rather than crashing the run.
 *
 * Matching is greedy and one-time-use. Bank transactions are processed in a
 * fixed order — ascending `(date, id)` — and each ledger entry and each document
 * can back at most one bank transaction, so a single ledger line is never
 * double-counted across two same-amount bank movements. Candidates are always
 * scoped to the SAME firm and entity as the bank transaction.
 *
 * NOTE: greedy closest-date matching is a deterministic heuristic, not a
 * guaranteed *maximum* matching — an ambiguous set of same-amount entries within
 * tolerance can leave a satisfiable pair unmatched. That is acceptable here: any
 * item the heuristic can't confidently pair surfaces as an exception for the
 * reconciliation team to resolve (the "AI/engine prepares, human reviews"
 * principle). Optimal bipartite assignment is future work.
 */

import type {
  BankTransaction,
  ExceptionCode,
  LedgerCashEntry,
  MatchStatus,
  ReconException,
  ReconInput,
  ReconResult,
  SourceDocument,
  ThreeWayMatch,
} from './types';

// --------------------------------------------------------------------------
// Date parsing (mirrors packages/fund-admin/src/checks.ts `toEpochDay`)
// --------------------------------------------------------------------------

/**
 * Parse a strict `YYYY-MM-DD` (optionally with a `T…` time suffix) into a whole
 * UTC epoch-day integer. Returns `null` for anything that is not a real calendar
 * date (rejects e.g. month 13, day 32, or 2026-02-30).
 */
function toEpochDay(iso: string): number | null {
  // Validate the WHOLE string so a malformed time suffix (e.g. "2026-06-01Tx")
  // is rejected, not silently truncated to a valid day.
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
      iso,
    );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(utc / 86_400_000);
}

// --------------------------------------------------------------------------
// Deterministic ordering helpers
// --------------------------------------------------------------------------

/** Total string order (lexicographic), returning -1 | 0 | 1. */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort by ISO `date` then `id`, both ascending. ISO dates sort lexically. */
function byDateThenId<T extends { date: string; id: string }>(a: T, b: T): number {
  return cmpStr(a.date, b.date) || cmpStr(a.id, b.id);
}

// --------------------------------------------------------------------------
// Candidate selection (pure)
// --------------------------------------------------------------------------

interface Candidate<T> {
  item: T;
  dayDiff: number; // absolute |dateDiff| in whole days
}

/**
 * Pick the best candidate: smallest absolute date difference, ties broken by the
 * lowest `id`. Returns `null` when there are no candidates.
 */
function pickClosest<T extends { id: string }>(candidates: Candidate<T>[]): Candidate<T> | null {
  let best: Candidate<T> | null = null;
  for (const c of candidates) {
    if (
      best === null ||
      c.dayDiff < best.dayDiff ||
      (c.dayDiff === best.dayDiff && cmpStr(c.item.id, best.item.id) < 0)
    ) {
      best = c;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Exception + match builders (respect exactOptionalPropertyTypes)
// --------------------------------------------------------------------------

interface ExceptionRefs {
  bankTransactionId?: string;
  ledgerEntryId?: string;
  documentId?: string;
}

function makeException(code: ExceptionCode, message: string, refs: ExceptionRefs): ReconException {
  return {
    code,
    message,
    ...(refs.bankTransactionId !== undefined ? { bankTransactionId: refs.bankTransactionId } : {}),
    ...(refs.ledgerEntryId !== undefined ? { ledgerEntryId: refs.ledgerEntryId } : {}),
    ...(refs.documentId !== undefined ? { documentId: refs.documentId } : {}),
  };
}

interface MatchDraft {
  bankTransactionId: string;
  ledgerEntryId?: string;
  documentId?: string;
  status: MatchStatus;
  confidence: number;
  reasons: string[];
}

function makeMatch(draft: MatchDraft): ThreeWayMatch {
  return {
    bankTransactionId: draft.bankTransactionId,
    status: draft.status,
    confidence: draft.confidence,
    reasons: draft.reasons,
    ...(draft.ledgerEntryId !== undefined ? { ledgerEntryId: draft.ledgerEntryId } : {}),
    ...(draft.documentId !== undefined ? { documentId: draft.documentId } : {}),
  };
}

const CONFIDENCE: Record<MatchStatus, number> = {
  matched: 1.0,
  partial: 0.7,
  unmatched: 0.0,
};

// --------------------------------------------------------------------------
// Core reconciliation
// --------------------------------------------------------------------------

/**
 * Reconcile a bank feed against the ledger and supporting documents.
 *
 * Rules:
 *  - A bank txn matches a LEDGER entry iff same currency, EXACT same signed
 *    `amountMinor`, and `|dateDiff| <= dateToleranceDays`. Among candidates the
 *    closest date wins, ties broken by the lowest ledger id. Each ledger entry
 *    backs at most one bank txn.
 *  - Given a bank↔ledger match, a DOCUMENT matches iff same currency,
 *    `document.amountMinor === abs(bank.amountMinor)`, and the document date is
 *    within tolerance of the bank date. Each document backs at most one match.
 *  - status: 'matched' (ledger + doc), 'partial' (ledger only), 'unmatched'
 *    (no ledger). confidence: 1.0 / 0.7 / 0.0 respectively.
 */
export function reconcile(input: ReconInput): ReconResult {
  const tolerance = input.dateToleranceDays;
  // A NaN/negative/non-integer tolerance would make every `dayDiff > tolerance`
  // comparison false and thus false-match unrelated dates. Reject it.
  if (!Number.isInteger(tolerance) || tolerance < 0) {
    throw new Error(
      `reconcile requires a non-negative integer dateToleranceDays, got ${tolerance}`,
    );
  }

  const banks: BankTransaction[] = [...input.bank].sort(byDateThenId);
  const usedLedger = new Set<string>();
  const usedDocuments = new Set<string>();

  const matches: ThreeWayMatch[] = [];
  const exceptions: ReconException[] = [];
  // Deferred so all bank-derived exceptions precede ledger ones in the output.
  const currencyMismatchExceptions: ReconException[] = [];

  for (const bank of banks) {
    const bankDay = toEpochDay(bank.date);
    const magnitude = Math.abs(bank.amountMinor);

    // --- Ledger candidates: same firm+entity, exact signed amount, in tolerance. ---
    const ledgerCandidates: Candidate<LedgerCashEntry>[] = [];
    let currencyMismatchCandidate: Candidate<LedgerCashEntry> | null = null;

    if (bankDay !== null) {
      const near: Candidate<LedgerCashEntry>[] = [];
      for (const entry of input.ledger) {
        if (usedLedger.has(entry.id)) continue;
        if (entry.firmId !== bank.firmId || entry.entityId !== bank.entityId) continue;
        if (entry.amountMinor !== bank.amountMinor) continue;
        const entryDay = toEpochDay(entry.date);
        if (entryDay === null) continue;
        const dayDiff = Math.abs(entryDay - bankDay);
        if (dayDiff > tolerance) continue;
        if (entry.currency === bank.currency) {
          ledgerCandidates.push({ item: entry, dayDiff });
        } else {
          near.push({ item: entry, dayDiff });
        }
      }
      // A same-amount, in-tolerance candidate blocked only by currency.
      currencyMismatchCandidate = pickClosest(near);
    }

    const ledgerPick = pickClosest(ledgerCandidates);

    if (ledgerPick === null) {
      // No ledger match — surface a currency-mismatch near miss, then UNMATCHED.
      if (currencyMismatchCandidate !== null) {
        const cand = currencyMismatchCandidate.item;
        currencyMismatchExceptions.push(
          makeException(
            'CURRENCY_MISMATCH',
            `bank ${bank.currency} vs ledger ${cand.currency} for amount ${bank.amountMinor}; ` +
              `date within ${currencyMismatchCandidate.dayDiff}d`,
            { bankTransactionId: bank.id, ledgerEntryId: cand.id },
          ),
        );
      }
      exceptions.push(
        makeException('UNMATCHED_BANK', `no ledger entry for bank txn ${bank.id}`, {
          bankTransactionId: bank.id,
        }),
      );
      matches.push(
        makeMatch({
          bankTransactionId: bank.id,
          status: 'unmatched',
          confidence: CONFIDENCE.unmatched,
          reasons: ['no matching ledger entry'],
        }),
      );
      continue;
    }

    const ledger = ledgerPick.item;
    usedLedger.add(ledger.id);

    const reasons: string[] = [
      `amount ${bank.amountMinor} ${bank.currency}`,
      `date within ${ledgerPick.dayDiff}d`,
    ];

    // --- Document candidates: same firm+entity, unsigned magnitude, in tolerance. ---
    let documentPick: Candidate<SourceDocument> | null = null;
    let docCurrencyMismatch: Candidate<SourceDocument> | null = null;
    if (bankDay !== null) {
      const docCandidates: Candidate<SourceDocument>[] = [];
      const nearDocs: Candidate<SourceDocument>[] = [];
      for (const doc of input.documents) {
        if (usedDocuments.has(doc.id)) continue;
        if (doc.firmId !== bank.firmId || doc.entityId !== bank.entityId) continue;
        if (doc.amountMinor !== magnitude) continue;
        const docDay = toEpochDay(doc.date);
        if (docDay === null) continue;
        const dayDiff = Math.abs(docDay - bankDay);
        if (dayDiff > tolerance) continue;
        if (doc.currency === bank.currency) docCandidates.push({ item: doc, dayDiff });
        else nearDocs.push({ item: doc, dayDiff });
      }
      documentPick = pickClosest(docCandidates);
      docCurrencyMismatch = pickClosest(nearDocs);
    }

    if (documentPick !== null) {
      const doc = documentPick.item;
      usedDocuments.add(doc.id);
      reasons.push(`doc ${doc.kind} ${doc.reference}`);
      matches.push(
        makeMatch({
          bankTransactionId: bank.id,
          ledgerEntryId: ledger.id,
          documentId: doc.id,
          status: 'matched',
          confidence: CONFIDENCE.matched,
          reasons,
        }),
      );
    } else {
      // A same-amount, in-tolerance document blocked only by currency is a
      // currency mismatch, NOT a missing document.
      if (docCurrencyMismatch !== null) {
        const doc = docCurrencyMismatch.item;
        reasons.push(`document currency mismatch (${doc.currency} vs ${bank.currency})`);
        currencyMismatchExceptions.push(
          makeException(
            'CURRENCY_MISMATCH',
            `bank ${bank.currency} vs document ${doc.currency} for amount ${magnitude}`,
            { bankTransactionId: bank.id, ledgerEntryId: ledger.id, documentId: doc.id },
          ),
        );
      } else {
        reasons.push('no supporting document');
        exceptions.push(
          makeException('MISSING_DOCUMENT', `no supporting document for bank txn ${bank.id}`, {
            bankTransactionId: bank.id,
            ledgerEntryId: ledger.id,
          }),
        );
      }
      matches.push(
        makeMatch({
          bankTransactionId: bank.id,
          ledgerEntryId: ledger.id,
          status: 'partial',
          confidence: CONFIDENCE.partial,
          reasons,
        }),
      );
    }
  }

  // Currency-mismatch context follows the primary bank exceptions.
  for (const ex of currencyMismatchExceptions) exceptions.push(ex);

  // --- Unmatched ledger entries, in deterministic (date, id) order. ---
  const ledgerSorted: LedgerCashEntry[] = [...input.ledger].sort(byDateThenId);
  for (const entry of ledgerSorted) {
    if (usedLedger.has(entry.id)) continue;
    exceptions.push(
      makeException('UNMATCHED_LEDGER', `no bank txn for ledger entry ${entry.id}`, {
        ledgerEntryId: entry.id,
      }),
    );
  }

  return { matches, exceptions };
}
