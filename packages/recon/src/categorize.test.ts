import { describe, expect, it } from 'vitest';

import {
  autoCategorizationRate,
  categorize,
  categorizeAll,
  RULES,
  type Categorization,
} from './categorize';
import type { BankTransaction } from './types';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

let seq = 0;
/** Build a BankTransaction with sensible defaults; override as needed. */
function txn(over: Partial<BankTransaction> = {}): BankTransaction {
  seq += 1;
  return {
    id: `bt-${seq}`,
    firmId: 'firm-1',
    entityId: 'fund-1',
    date: '2026-07-01',
    amountMinor: 100_000,
    currency: 'USD',
    description: '',
    ...over,
  };
}

describe('categorize — representative mappings', () => {
  it('capital call inflow -> lp_contribution / 3000', () => {
    const c = categorize(txn({ description: 'Capital Call #4 drawdown', amountMinor: 5_000_000 }));
    expect(c.category).toBe('lp_contribution');
    expect(c.accountCodeHint).toBe('3000');
    expect(c.matchedRule).toBe('LP_CAPITAL_CALL_INFLOW');
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('subscription inflow -> lp_contribution', () => {
    const c = categorize(txn({ description: 'LP subscription proceeds', amountMinor: 2_000_000 }));
    expect(c.category).toBe('lp_contribution');
    expect(c.accountCodeHint).toBe('3000');
  });

  it('distribution outflow -> distribution / 3000', () => {
    const c = categorize(
      txn({ description: 'Quarterly distribution to LPs', amountMinor: -3_000_000 }),
    );
    expect(c.category).toBe('distribution');
    expect(c.accountCodeHint).toBe('3000');
  });

  it('redemption outflow -> distribution', () => {
    const c = categorize(
      txn({ description: 'Investor redemption payout', amountMinor: -1_250_000 }),
    );
    expect(c.category).toBe('distribution');
  });

  it('management fee -> management_fee / 6000', () => {
    const c = categorize(txn({ description: 'Q2 mgmt fee', amountMinor: -250_000 }));
    expect(c.category).toBe('management_fee');
    expect(c.accountCodeHint).toBe('6000');
  });

  it('wire fee -> bank_fee / 6100', () => {
    const c = categorize(txn({ description: 'Outgoing wire fee', amountMinor: -2_500 }));
    expect(c.category).toBe('bank_fee');
    expect(c.accountCodeHint).toBe('6100');
  });

  it('interest inflow -> interest_income / 4000', () => {
    const c = categorize(
      txn({ description: 'Interest paid on cash balance', amountMinor: 12_345 }),
    );
    expect(c.category).toBe('interest_income');
    expect(c.accountCodeHint).toBe('4000');
  });

  it('legal invoice -> professional_fees / 6200', () => {
    const c = categorize(
      txn({ description: 'Legal services', counterparty: 'Wachtell', amountMinor: -900_000 }),
    );
    expect(c.category).toBe('professional_fees');
    expect(c.accountCodeHint).toBe('6200');
  });

  it('audit -> professional_fees', () => {
    const c = categorize(txn({ description: 'Annual audit fee', amountMinor: -400_000 }));
    expect(c.category).toBe('professional_fees');
  });

  it('custody fee -> custody_fee / 6300', () => {
    const c = categorize(txn({ description: 'Custodian safekeeping fee', amountMinor: -50_000 }));
    expect(c.category).toBe('custody_fee');
    expect(c.accountCodeHint).toBe('6300');
  });

  it('vendor invoice outflow -> vendor_expense / 6000', () => {
    const c = categorize(
      txn({ description: 'Invoice payment', counterparty: 'Acme Vendor', amountMinor: -75_000 }),
    );
    expect(c.category).toBe('vendor_expense');
    expect(c.accountCodeHint).toBe('6000');
  });

  it('FX conversion -> fx / 1900', () => {
    const c = categorize(txn({ description: 'FX conversion USD/EUR', amountMinor: -10_000 }));
    expect(c.category).toBe('fx');
    expect(c.accountCodeHint).toBe('1900');
  });

  it('matches on counterparty as well as description', () => {
    const c = categorize(
      txn({ description: 'Payment', counterparty: 'Custody Bank NA', amountMinor: -1_000 }),
    );
    expect(c.category).toBe('custody_fee');
  });
});

describe('categorize — unknown & fallback', () => {
  it('unknown description -> uncategorized with null rule and low confidence', () => {
    const c = categorize(txn({ description: 'zzz mystery movement', amountMinor: -1 }));
    expect(c.category).toBe('uncategorized');
    expect(c.accountCodeHint).toBe('9999');
    expect(c.matchedRule).toBeNull();
    expect(c.confidence).toBeLessThan(0.5);
  });
});

describe('categorize — sign sensitivity', () => {
  it('contribution inflow -> lp_contribution, but a contribution outflow does not', () => {
    const inflow = categorize(
      txn({ description: 'contribution received', amountMinor: 1_000_000 }),
    );
    expect(inflow.category).toBe('lp_contribution');

    // Same keyword, opposite sign: the inflow-only rule must NOT fire.
    const outflow = categorize(
      txn({ description: 'contribution received', amountMinor: -1_000_000 }),
    );
    expect(outflow.category).not.toBe('lp_contribution');
  });

  it('interest inflow is income, interest outflow is expense', () => {
    expect(categorize(txn({ description: 'interest', amountMinor: 500 })).category).toBe(
      'interest_income',
    );
    expect(categorize(txn({ description: 'interest', amountMinor: -500 })).category).toBe(
      'interest_expense',
    );
  });
});

describe('categorizeAll & autoCategorizationRate', () => {
  const batch: BankTransaction[] = [
    txn({ description: 'Capital Call #1', amountMinor: 5_000_000 }),
    txn({ description: 'Management fee Q2', amountMinor: -250_000 }),
    txn({ description: 'Wire fee', amountMinor: -2_500 }),
    txn({ description: 'Legal services', amountMinor: -100_000 }),
    txn({ description: 'zzz unknown', amountMinor: -42 }), // uncategorized
  ];

  it('categorizeAll preserves order and length', () => {
    const results = categorizeAll(batch);
    expect(results).toHaveLength(batch.length);
    expect(results[0]?.category).toBe('lp_contribution');
    expect(results[4]?.category).toBe('uncategorized');
  });

  it('autoCategorizationRate counts confident matches (4 of 5)', () => {
    expect(autoCategorizationRate(batch)).toBeCloseTo(4 / 5);
  });

  it('respects a custom threshold', () => {
    // With a threshold above every rule confidence, nothing qualifies.
    expect(autoCategorizationRate(batch, 0.99)).toBe(0);
  });

  it('empty batch -> rate 0', () => {
    expect(autoCategorizationRate([])).toBe(0);
    expect(categorizeAll([])).toEqual([]);
  });
});

describe('determinism & invariants', () => {
  it('same txn categorized twice yields identical results', () => {
    const t = txn({ description: 'Custodian fee', amountMinor: -1_000 });
    const a: Categorization = categorize(t);
    const b: Categorization = categorize(t);
    expect(a).toEqual(b);
  });

  it('ships at least 12 rules, ordered most-specific first', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(12);
    // The LP capital-call rule must precede the generic vendor/investment rules.
    const capIdx = RULES.findIndex((r) => r.name === 'LP_CAPITAL_CALL_INFLOW');
    const vendorIdx = RULES.findIndex((r) => r.name === 'VENDOR_EXPENSE');
    expect(capIdx).toBeGreaterThanOrEqual(0);
    expect(vendorIdx).toBeGreaterThan(capIdx);
  });

  it('every rule confidence is within 0..1', () => {
    for (const r of RULES) {
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('categorize — Codex Gate 3.1 regressions', () => {
  const txn = (over: Partial<import('./types').BankTransaction> = {}) => ({
    id: 't1',
    firmId: 'f1',
    entityId: 'e1',
    date: '2026-06-01',
    amountMinor: 5_000,
    currency: 'USD',
    description: '',
    ...over,
  });

  it('does not misfire on a substring ("wholesale rebate" is not an investment sale)', () => {
    const c = categorize(txn({ amountMinor: 5_000, description: 'wholesale rebate' }));
    expect(c.category).not.toBe('investment_sale');
    expect(c.matchedRule).toBeNull();
  });

  it('autoCategorizationRate never counts an uncategorized txn, even at threshold 0.1', () => {
    const rate = autoCategorizationRate([txn({ description: 'totally unknown thing' })], 0.1);
    expect(rate).toBe(0);
  });
});
