import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { money, isZero } from '@gramercy/core';
import type { Account, AccountType, JournalLineInput } from '@gramercy/ledger';
import {
  consolidate,
  groupTrialBalanceNet,
  type EntityLedger,
  type IntercompanyPair,
} from './index';

const USD = 'USD';

function acct(id: string, entityId: string, type: AccountType): Account {
  return { id, entityId, code: id, name: id, type };
}

function line(
  accountId: string,
  entityId: string,
  side: 'debit' | 'credit',
  minor: number,
): JournalLineInput & { entityId: string } {
  return { accountId, entityId, side, amount: money(minor, USD) };
}

function findLine<T extends { accountId: string }>(lines: readonly T[], accountId: string) {
  return lines.find((l) => l.accountId === accountId);
}

describe('consolidate — two entities with an intercompany due-to/due-from', () => {
  // MgmtCo pays $1,000 on behalf of the Fund:
  //   MgmtCo:  debit due-from-Fund 100000 / credit cash 100000  (an asset swap)
  //   Fund:    debit expense 100000        / credit due-to-MgmtCo 100000
  const AMT = 100_000; // $1,000 in cents

  const accounts = new Map<string, Account>([
    ['mgmt.duefrom', acct('mgmt.duefrom', 'mgmtco', 'asset')],
    ['mgmt.cash', acct('mgmt.cash', 'mgmtco', 'asset')],
    ['fund.expense', acct('fund.expense', 'fund', 'expense')],
    ['fund.dueto', acct('fund.dueto', 'fund', 'liability')],
  ]);

  const entities: EntityLedger[] = [
    {
      entityId: 'mgmtco',
      lines: [
        line('mgmt.duefrom', 'mgmtco', 'debit', AMT),
        line('mgmt.cash', 'mgmtco', 'credit', AMT),
      ],
    },
    {
      entityId: 'fund',
      lines: [
        line('fund.expense', 'fund', 'debit', AMT),
        line('fund.dueto', 'fund', 'credit', AMT),
      ],
    },
  ];

  const eliminations: IntercompanyPair[] = [
    { dueToAccountId: 'fund.dueto', dueFromAccountId: 'mgmt.duefrom' },
  ];

  const result = consolidate(entities, accounts, eliminations, USD);

  it('nets the group trial balance to zero', () => {
    expect(result.groupTrialBalanceNets).toBe(true);
    expect(isZero(groupTrialBalanceNet(result.group, USD))).toBe(true);
  });

  it('removes the intercompany balances from the group', () => {
    expect(findLine(result.group, 'mgmt.duefrom')).toBeUndefined();
    expect(findLine(result.group, 'fund.dueto')).toBeUndefined();
    // The real economic activity remains.
    expect(findLine(result.group, 'mgmt.cash')).toBeDefined();
    expect(findLine(result.group, 'fund.expense')).toBeDefined();
  });

  it('records the eliminated magnitude', () => {
    expect(result.eliminatedMinor).toBe(AMT);
  });

  it('preserves each entity own balances', () => {
    const mgmt = result.byEntity.get('mgmtco')!;
    const fund = result.byEntity.get('fund')!;
    // Due-from is a debit-normal asset: normalBalance positive, still present per-entity.
    expect(findLine(mgmt, 'mgmt.duefrom')!.normalBalance.amount).toBe(AMT);
    expect(findLine(mgmt, 'mgmt.cash')!.normalBalance.amount).toBe(-AMT);
    // Due-to is a credit-normal liability: normalBalance positive per-entity.
    expect(findLine(fund, 'fund.dueto')!.normalBalance.amount).toBe(AMT);
    expect(findLine(fund, 'fund.expense')!.normalBalance.amount).toBe(AMT);
  });
});

describe('consolidate — non-netting elimination pair', () => {
  it('throws when the two legs do not net to zero', () => {
    const accounts = new Map<string, Account>([
      ['mgmt.duefrom', acct('mgmt.duefrom', 'mgmtco', 'asset')],
      ['mgmt.cash', acct('mgmt.cash', 'mgmtco', 'asset')],
      ['fund.expense', acct('fund.expense', 'fund', 'expense')],
      ['fund.dueto', acct('fund.dueto', 'fund', 'liability')],
    ]);
    const entities: EntityLedger[] = [
      {
        entityId: 'mgmtco',
        lines: [
          line('mgmt.duefrom', 'mgmtco', 'debit', 100_000),
          line('mgmt.cash', 'mgmtco', 'credit', 100_000),
        ],
      },
      {
        // Fund's due-to is only 50000 — each entity balances, but the pair does not.
        entityId: 'fund',
        lines: [
          line('fund.expense', 'fund', 'debit', 50_000),
          line('fund.dueto', 'fund', 'credit', 50_000),
        ],
      },
    ];
    expect(() =>
      consolidate(
        entities,
        accounts,
        [{ dueToAccountId: 'fund.dueto', dueFromAccountId: 'mgmt.duefrom' }],
        USD,
      ),
    ).toThrow(/does not net to zero/);
  });
});

describe('consolidate — currency mismatch', () => {
  it('throws when a line is denominated in another currency', () => {
    const accounts = new Map<string, Account>([
      ['a', acct('a', 'e1', 'asset')],
      ['b', acct('b', 'e1', 'income')],
    ]);
    const entities: EntityLedger[] = [
      {
        entityId: 'e1',
        lines: [
          { accountId: 'a', entityId: 'e1', side: 'debit', amount: money(100, 'EUR') },
          { accountId: 'b', entityId: 'e1', side: 'credit', amount: money(100, 'EUR') },
        ],
      },
    ];
    expect(() => consolidate(entities, accounts, [], USD)).toThrow(/Currency mismatch/);
  });
});

describe('property: group trial balance nets to zero for balanced inputs', () => {
  it('holds for any number of independently-balanced entities', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 12 }),
        (amounts) => {
          const accounts = new Map<string, Account>();
          const entities: EntityLedger[] = [];
          amounts.forEach((amt, i) => {
            const dr = `e${i}.dr`;
            const cr = `e${i}.cr`;
            const eid = `e${i}`;
            accounts.set(dr, acct(dr, eid, 'asset'));
            accounts.set(cr, acct(cr, eid, 'income'));
            entities.push({
              entityId: eid,
              lines: [line(dr, eid, 'debit', amt), line(cr, eid, 'credit', amt)],
            });
          });
          const result = consolidate(entities, accounts, [], USD);
          return result.groupTrialBalanceNets && isZero(groupTrialBalanceNet(result.group, USD));
        },
      ),
    );
  });
});
