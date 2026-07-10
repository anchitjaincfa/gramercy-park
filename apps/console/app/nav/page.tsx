import { PageHeader, Card, CardHeader, StatTile, Badge, TableScroll } from '@/components/ui';
import { formatUSD, formatUSDCompact, formatDate } from '@/lib/format';
import { navTotalMinor, navComponents, navPerLp, capitalAccounts, lpsById, fund } from '@/lib/seed';

export default function NavPage() {
  const shares = [...navPerLp].sort((a, b) => b.navShareMinor - a.navShareMinor);

  return (
    <div>
      <PageHeader
        title="Net Asset Value"
        subtitle="NAV is read purely from the posted general ledger — Σ(asset balances) − Σ(liability balances) — then allocated across LPs pro-rata to their capital-account balances with exact largest-remainder math."
        actions={<Badge tone="neutral">As of {formatDate(fund.asOf)}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total assets" value={formatUSDCompact(navComponents.assets)} />
        <StatTile label="Total liabilities" value={formatUSDCompact(navComponents.liabilities)} />
        <StatTile label="Net asset value" value={formatUSDCompact(navTotalMinor)} accent />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="NAV bridge — from the posted GL" />
          <TableScroll>
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {navComponents.byAccount.map((row) => (
                  <tr key={row.account.id}>
                    <td className="px-5 py-3 text-slate-700">
                      <span className="tnum font-mono text-xs text-slate-400">
                        {row.account.code}
                      </span>{' '}
                      {row.account.name}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={row.account.type === 'asset' ? 'pass' : 'warn'}>
                        {row.account.type}
                      </Badge>
                    </td>
                    <td className="tnum px-5 py-3 text-right font-medium text-slate-800">
                      {row.account.type === 'liability' ? '(' : ''}
                      {formatUSD(row.normalMinor)}
                      {row.account.type === 'liability' ? ')' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-5 py-3 text-slate-700" colSpan={2}>
                    Net asset value
                  </td>
                  <td className="tnum px-5 py-3 text-right text-accent-700">
                    {formatUSD(navTotalMinor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Card>

        <Card>
          <CardHeader title="Per-LP NAV share" meta={`${shares.length} LPs`} />
          <TableScroll>
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Limited partner</th>
                  <th className="px-5 py-3 text-right font-medium">Capital balance</th>
                  <th className="px-5 py-3 text-right font-medium">NAV share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {shares.map((s) => {
                  const bal = capitalAccounts.get(s.lpId);
                  return (
                    <tr key={s.lpId} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-800">
                        {lpsById[s.lpId]?.name ?? s.lpId}
                      </td>
                      <td className="tnum px-5 py-3 text-right text-slate-500">
                        {formatUSD(bal?.balanceMinor ?? 0)}
                      </td>
                      <td className="tnum px-5 py-3 text-right font-semibold text-accent-700">
                        {formatUSD(s.navShareMinor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-5 py-3 text-slate-700">Total</td>
                  <td className="px-5 py-3" />
                  <td className="tnum px-5 py-3 text-right text-accent-700">
                    {formatUSD(shares.reduce((sum, s) => sum + s.navShareMinor, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Card>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Per-LP shares are computed by the engine so they sum exactly back to the total NAV — no cent
        created or destroyed.
      </p>
    </div>
  );
}
