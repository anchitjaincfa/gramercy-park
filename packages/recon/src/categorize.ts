/**
 * Deterministic GL categorization for bank transactions (Phase 3, see
 * docs/ARCHITECTURE.md §"Pillar 1 — Reconciliation").
 *
 * The reconciliation engine auto-suggests a general-ledger account for each
 * incoming bank line so the recon team only touches the ~10% that need human
 * judgment. This module is a pure, rule-based categorizer — NO AI/LLM calls.
 * Each rule is a keyword/sign predicate over a `BankTransaction`; rules are
 * evaluated most-specific-first and the FIRST match wins.
 *
 * Everything here is deterministic and side-effect free: the same transaction
 * always yields the same `Categorization`. Money is signed integer minor units
 * (`amountMinor`: + inflow, − outflow), matching the bank feed convention.
 */

import type { BankTransaction } from './types';

/** The suggested categorization for a single bank transaction. */
export interface Categorization {
  /** Semantic category (e.g. 'management_fee', 'lp_contribution'). */
  category: string;
  /** Suggested GL account code (chart-of-accounts hint). */
  accountCodeHint: string;
  /** 0..1 confidence in the suggestion. */
  confidence: number;
  /** Name of the rule that matched, or null when uncategorized. */
  matchedRule: string | null;
}

/** A single categorization rule. `test` is a pure predicate over the txn. */
export interface CategoryRule {
  name: string;
  test: (txn: BankTransaction) => boolean;
  category: string;
  accountCodeHint: string;
  confidence: number;
}

// --------------------------------------------------------------------------
// Predicate helpers (pure, case-insensitive)
// --------------------------------------------------------------------------

/** Lower-cased `description` + `counterparty`, so rules match either field. */
function haystack(txn: BankTransaction): string {
  return `${txn.description} ${txn.counterparty ?? ''}`.toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True if the transaction text contains any keyword as a WHOLE word/phrase
 * (alphanumeric boundaries), so e.g. "wholesale rebate" does not match the
 * keyword "sale" and "buyer" does not match "buy". Multi-word phrases are
 * matched literally between boundaries.
 */
function hasAny(txn: BankTransaction, keywords: readonly string[]): boolean {
  const text = haystack(txn);
  return keywords.some((k) => {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(k.toLowerCase())}(?![a-z0-9])`);
    return re.test(text);
  });
}

const isInflow = (txn: BankTransaction): boolean => txn.amountMinor > 0;
const isOutflow = (txn: BankTransaction): boolean => txn.amountMinor < 0;

// --------------------------------------------------------------------------
// Rules — ordered MOST SPECIFIC first; the first match wins.
// --------------------------------------------------------------------------

export const RULES: CategoryRule[] = [
  // 1. LP capital coming in: capital call / drawdown / contribution / subscription.
  {
    name: 'LP_CAPITAL_CALL_INFLOW',
    test: (txn) =>
      isInflow(txn) &&
      hasAny(txn, ['capital call', 'drawdown', 'draw down', 'contribution', 'subscription']),
    category: 'lp_contribution',
    accountCodeHint: '3000',
    confidence: 0.95,
  },

  // 2. Capital returned to LPs: distribution / return of capital / redemption (outflow).
  {
    name: 'LP_DISTRIBUTION_OUTFLOW',
    test: (txn) =>
      isOutflow(txn) && hasAny(txn, ['distribution', 'return of capital', 'redemption', 'redeem']),
    category: 'distribution',
    accountCodeHint: '3000',
    confidence: 0.95,
  },

  // 3. Management / advisory fee (either direction; usually an outflow at fund level).
  {
    name: 'MANAGEMENT_FEE',
    test: (txn) => hasAny(txn, ['management fee', 'mgmt fee', 'mgt fee', 'advisory fee']),
    category: 'management_fee',
    accountCodeHint: '6000',
    confidence: 0.93,
  },

  // 4. Legal / audit / tax / accounting — professional services.
  {
    name: 'PROFESSIONAL_FEES',
    test: (txn) =>
      hasAny(txn, [
        'legal',
        'attorney',
        'law firm',
        'audit',
        'auditor',
        'tax',
        'accounting',
        'accountant',
      ]),
    category: 'professional_fees',
    accountCodeHint: '6200',
    confidence: 0.9,
  },

  // 5. Custody / custodian / safekeeping fees.
  {
    name: 'CUSTODY_FEE',
    test: (txn) => hasAny(txn, ['custody', 'custodian', 'safekeeping']),
    category: 'custody_fee',
    accountCodeHint: '6300',
    confidence: 0.9,
  },

  // 6. Administration / fund admin / transfer-agent fees.
  {
    name: 'ADMIN_FEE',
    test: (txn) => hasAny(txn, ['fund admin', 'administration fee', 'admin fee', 'transfer agent']),
    category: 'admin_fee',
    accountCodeHint: '6400',
    confidence: 0.88,
  },

  // 7. Wire / bank / transfer service charges (specific fee keywords).
  {
    name: 'BANK_FEE',
    test: (txn) =>
      hasAny(txn, [
        'wire fee',
        'bank fee',
        'service charge',
        'transfer fee',
        'account fee',
        'atm fee',
      ]),
    category: 'bank_fee',
    accountCodeHint: '6100',
    confidence: 0.9,
  },

  // 8. FX / foreign-exchange conversions.
  {
    name: 'FX_CONVERSION',
    test: (txn) =>
      hasAny(txn, ['fx', 'forex', 'foreign exchange', 'currency conversion', 'fx conversion']),
    category: 'fx',
    accountCodeHint: '1900',
    confidence: 0.85,
  },

  // 9. Interest earned (inflow).
  {
    name: 'INTEREST_INCOME',
    test: (txn) => isInflow(txn) && hasAny(txn, ['interest', 'accrued interest']),
    category: 'interest_income',
    accountCodeHint: '4000',
    confidence: 0.9,
  },

  // 10. Interest paid / financing cost (outflow).
  {
    name: 'INTEREST_EXPENSE',
    test: (txn) => isOutflow(txn) && hasAny(txn, ['interest', 'loan interest', 'credit facility']),
    category: 'interest_expense',
    accountCodeHint: '6500',
    confidence: 0.85,
  },

  // 11. Dividend income (inflow).
  {
    name: 'DIVIDEND_INCOME',
    test: (txn) => isInflow(txn) && hasAny(txn, ['dividend']),
    category: 'dividend_income',
    accountCodeHint: '4100',
    confidence: 0.9,
  },

  // 12. Vendor / AP / invoice payments (outflow).
  {
    name: 'VENDOR_EXPENSE',
    test: (txn) =>
      isOutflow(txn) &&
      hasAny(txn, [
        'invoice',
        'vendor',
        'accounts payable',
        'ap payment',
        'bill payment',
        'payment to',
      ]),
    category: 'vendor_expense',
    accountCodeHint: '6000',
    confidence: 0.75,
  },

  // 13. Investment purchase / trade settlement outflow (asset movement).
  {
    name: 'INVESTMENT_PURCHASE',
    test: (txn) =>
      isOutflow(txn) &&
      hasAny(txn, ['purchase', 'buy', 'trade settlement', 'settlement', 'investment']),
    category: 'investment_purchase',
    accountCodeHint: '1500',
    confidence: 0.7,
  },

  // 14. Investment sale / proceeds inflow (asset movement).
  {
    name: 'INVESTMENT_SALE',
    test: (txn) =>
      isInflow(txn) && hasAny(txn, ['sale proceeds', 'sale', 'sell', 'proceeds', 'disposal']),
    category: 'investment_sale',
    accountCodeHint: '1500',
    confidence: 0.7,
  },
];

// --------------------------------------------------------------------------
// Categorizer
// --------------------------------------------------------------------------

/** The result returned when no rule matches. */
const UNCATEGORIZED: Categorization = {
  category: 'uncategorized',
  accountCodeHint: '9999',
  confidence: 0.1,
  matchedRule: null,
};

/**
 * Categorize a single bank transaction. Returns the FIRST matching rule's
 * result (rules are ordered most-specific-first), or an 'uncategorized'
 * result if none match. Pure and deterministic.
 */
export function categorize(txn: BankTransaction): Categorization {
  for (const rule of RULES) {
    if (rule.test(txn)) {
      return {
        category: rule.category,
        accountCodeHint: rule.accountCodeHint,
        confidence: rule.confidence,
        matchedRule: rule.name,
      };
    }
  }
  return { ...UNCATEGORIZED };
}

/** Categorize a batch of transactions (order preserved). */
export function categorizeAll(txns: readonly BankTransaction[]): Categorization[] {
  return txns.map((txn) => categorize(txn));
}

/**
 * Fraction (0..1) of transactions categorized with confidence >= `threshold`.
 * A transaction counts as auto-categorized only when it MATCHED A RULE (an
 * 'uncategorized' fallback never counts, even if the threshold is at or below
 * its nominal confidence). Returns 0 for an empty batch.
 */
export function autoCategorizationRate(txns: readonly BankTransaction[], threshold = 0.5): number {
  if (txns.length === 0) return 0;
  const auto = categorizeAll(txns).filter(
    (c) => c.matchedRule !== null && c.confidence >= threshold,
  ).length;
  return auto / txns.length;
}
