import { moicBps } from '@gramercy/portfolio';
import { PageHeader, Card, CardHeader, StatTile, Badge, TableScroll } from '@/components/ui';
import { formatUSD, formatUSDCompact, formatBps, formatMoic } from '@/lib/format';
import { portfolio, companiesById, investments } from '@/lib/seed';

export default function PortfolioPage() {
  const investmentById = Object.fromEntries(investments.map((i) => [i.id, i]));

  const rows = [...portfolio.positions].sort((a, b) => b.stakeValueMinor - a.stakeValueMinor);

  // Exact BigInt MOIC — never float division, which would drift at large values.
  const blendedMoicBps = moicBps(portfolio.totalFairValueMinor, portfolio.totalCostMinor);

  return (
    <div>
      <PageHeader
        title="Portfolio"
        subtitle="Equity-pickup rollup: each fund stake = fully-diluted ownership × company fair value, with MOIC and unrealized gain computed by the deterministic portfolio engine."
        actions={<Badge tone="pass">{formatMoic(blendedMoicBps)} blended MOIC</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total cost" value={formatUSDCompact(portfolio.totalCostMinor)} />
        <StatTile
          label="Fair value"
          value={formatUSDCompact(portfolio.totalFairValueMinor)}
          accent
        />
        <StatTile
          label="Unrealized gain"
          value={formatUSDCompact(portfolio.totalUnrealizedGainMinor)}
          sub={portfolio.totalUnrealizedGainMinor >= 0 ? 'Above cost' : 'Below cost'}
        />
        <StatTile label="Positions" value={String(portfolio.positions.length)} />
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader title="Positions" meta={`${rows.length} companies`} />
          <TableScroll>
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Ownership</th>
                  <th className="px-5 py-3 text-right font-medium">Cost</th>
                  <th className="px-5 py-3 text-right font-medium">Fair value</th>
                  <th className="px-5 py-3 text-right font-medium">Unrealized</th>
                  <th className="px-5 py-3 text-right font-medium">MOIC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((p) => {
                  const company = companiesById[p.companyId];
                  const inv = investmentById[p.investmentId];
                  const gain = p.unrealizedGainMinor;
                  return (
                    <tr key={p.investmentId} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">
                          {company?.name ?? p.companyId}
                        </div>
                        <div className="text-xs text-slate-400">
                          {company?.sector}
                          {inv ? ` · ${inv.round}` : ''}
                        </div>
                      </td>
                      <td className="tnum px-5 py-3 text-slate-600">{formatBps(p.ownershipBps)}</td>
                      <td className="tnum px-5 py-3 text-right text-slate-600">
                        {formatUSD(p.costMinor)}
                      </td>
                      <td className="tnum px-5 py-3 text-right font-medium text-slate-800">
                        {formatUSD(p.stakeValueMinor)}
                      </td>
                      <td
                        className={`tnum px-5 py-3 text-right font-medium ${
                          gain >= 0 ? 'text-accent-700' : 'text-rose-600'
                        }`}
                      >
                        {gain >= 0 ? '+' : '−'}
                        {formatUSD(Math.abs(gain))}
                      </td>
                      <td className="tnum px-5 py-3 text-right">
                        <Badge tone={p.moicBps >= 10000 ? 'pass' : 'fail'}>
                          {formatMoic(p.moicBps)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-5 py-3 text-slate-700" colSpan={2}>
                    Total
                  </td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(portfolio.totalCostMinor)}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(portfolio.totalFairValueMinor)}
                  </td>
                  <td
                    className={`tnum px-5 py-3 text-right ${
                      portfolio.totalUnrealizedGainMinor >= 0 ? 'text-accent-700' : 'text-rose-600'
                    }`}
                  >
                    {portfolio.totalUnrealizedGainMinor >= 0 ? '+' : '−'}
                    {formatUSD(Math.abs(portfolio.totalUnrealizedGainMinor))}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-accent-700">
                    {formatMoic(blendedMoicBps)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Card>
      </div>

      {portfolio.missingValuations.length > 0 ? (
        <p className="mt-6 text-xs text-amber-600">
          {portfolio.missingValuations.length} investment(s) excluded from totals — no current
          valuation on file.
        </p>
      ) : null}
    </div>
  );
}
