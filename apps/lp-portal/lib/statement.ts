/**
 * Period-by-period capital-account statement, derived from the SAME event stream
 * the engine folds. For each accounting period we present the classic movement
 * columns — opening balance, contributions, allocated P&L, management fees,
 * distributions, closing balance.
 *
 * The closing balance of each period is computed by folding the cumulative event
 * subset (all events up to and including that period) with the real engine
 * `capitalAccountBalance`, so the statement is guaranteed to reconcile: each
 * period's closing balance is the engine's balance as of that period end, and
 * the final period's closing equals `seed.balance.balanceMinor`.
 */

import { capitalAccountBalance, type CapitalAccountEvent } from '@gramercy/fund-admin';
import { events, lp } from './seed';

export interface StatementPeriod {
  key: string; // e.g. "2023"
  label: string; // e.g. "Year ended Dec 31, 2023"
  contributionsMinor: number;
  allocatedPnlMinor: number;
  mgmtFeesMinor: number;
  distributionsMinor: number;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
}

/** Map an ISO date to its fiscal-year key. */
function yearKey(iso: string): string {
  return iso.slice(0, 4);
}

/** The distinct fiscal years present in the stream, ascending. */
function periodKeys(evts: readonly CapitalAccountEvent[]): string[] {
  const keys = new Set<string>();
  for (const e of evts) keys.add(yearKey(e.date));
  return [...keys].sort();
}

/**
 * Build the annual capital-account statement rows. Movement sub-totals come
 * straight from the events in each period; opening/closing balances come from the
 * engine folded over cumulative subsets.
 */
export function buildAnnualStatement(): StatementPeriod[] {
  const keys = periodKeys(events);
  const rows: StatementPeriod[] = [];
  let priorClosing = 0;

  for (const key of keys) {
    const inPeriod = events.filter((e) => yearKey(e.date) === key);
    const upToPeriod = events.filter((e) => yearKey(e.date) <= key);

    let contributionsMinor = 0;
    let allocatedPnlMinor = 0;
    let mgmtFeesMinor = 0;
    let distributionsMinor = 0;
    for (const e of inPeriod) {
      switch (e.kind) {
        case 'contribution':
          contributionsMinor += e.amountMinor;
          break;
        case 'pnl_allocation':
          allocatedPnlMinor += e.amountMinor;
          break;
        case 'mgmt_fee':
          mgmtFeesMinor += e.amountMinor;
          break;
        case 'distribution':
          distributionsMinor += e.amountMinor;
          break;
      }
    }

    // Engine-computed closing balance as of this period end.
    const closingBalanceMinor = capitalAccountBalance(upToPeriod, lp.id).balanceMinor;

    rows.push({
      key,
      label: `Year ended Dec 31, ${key}`,
      contributionsMinor,
      allocatedPnlMinor,
      mgmtFeesMinor,
      distributionsMinor,
      openingBalanceMinor: priorClosing,
      closingBalanceMinor,
    });

    priorClosing = closingBalanceMinor;
  }

  return rows;
}
