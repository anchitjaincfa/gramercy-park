import { PageHeader, Panel, Pill } from '../../components/ui';
import { buildAnnualStatement } from '../../lib/statement';
import { balance, metrics, fund, lp, asOfDate, CURRENCY } from '../../lib/seed';
import { formatUSD, formatSignedUSD, formatDate } from '../../lib/format';

export default function CapitalAccountPage() {
  const rows = buildAnnualStatement();

  // Inception-to-date movement totals (== engine balance components).
  const itd = {
    contributions: balance.contributedMinor,
    allocatedPnl: balance.allocatedPnlMinor,
    mgmtFees: balance.feesMinor,
    distributions: balance.distributedMinor,
    closing: balance.balanceMinor,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Capital Account Statement"
        title="Statement of Partner's Capital"
        description={`${lp.name} — ${fund.name}. Reconstructed deterministically from your capital-account event history.`}
        aside={
          <div className="text-left sm:text-right">
            <p className="eyebrow">Closing Balance · {formatDate(asOfDate)}</p>
            <p className="tnum mt-1 font-serif text-3xl font-semibold text-ink-900">
              {formatUSD(itd.closing)}
            </p>
          </div>
        }
      />

      {/* The statement */}
      <div className="panel overflow-hidden shadow-statement">
        <div className="flex flex-col gap-3 border-b border-parchment-200 bg-parchment-100/60 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-lg font-semibold text-ink-900">{lp.name}</p>
            <p className="text-xs text-ink-700/70">
              {lp.className} · Account {lp.id.toUpperCase()}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-ink-700/70">{fund.name}</p>
            <p className="text-xs text-ink-700/70">Denominated in {CURRENCY}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-parchment-200 text-left">
                <th className="px-6 py-3 font-medium text-ink-700/70">Period</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">
                  Opening Balance
                </th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Contributions</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Allocated P&L</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Mgmt Fees</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Distributions</th>
                <th className="px-6 py-3 text-right font-medium text-ink-900">Closing Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment-200">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-parchment-100/40">
                  <td className="px-6 py-3.5">
                    <div className="font-medium text-ink-900">FY {r.key}</div>
                    <div className="text-xs text-ink-700/60">{r.label}</div>
                  </td>
                  <td className="tnum px-4 py-3.5 text-right text-ink-700/90">
                    {formatUSD(r.openingBalanceMinor)}
                  </td>
                  <td className="tnum px-4 py-3.5 text-right text-ink-900">
                    {r.contributionsMinor ? formatSignedUSD(r.contributionsMinor) : '—'}
                  </td>
                  <td
                    className={`tnum px-4 py-3.5 text-right ${
                      r.allocatedPnlMinor < 0 ? 'text-red-700' : 'text-sage-600'
                    }`}
                  >
                    {r.allocatedPnlMinor ? formatSignedUSD(r.allocatedPnlMinor) : '—'}
                  </td>
                  <td className="tnum px-4 py-3.5 text-right text-red-700/90">
                    {r.mgmtFeesMinor ? formatSignedUSD(-r.mgmtFeesMinor) : '—'}
                  </td>
                  <td className="tnum px-4 py-3.5 text-right text-red-700/90">
                    {r.distributionsMinor ? formatSignedUSD(-r.distributionsMinor) : '—'}
                  </td>
                  <td className="tnum px-6 py-3.5 text-right font-semibold text-ink-900">
                    {formatUSD(r.closingBalanceMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900/15 bg-parchment-100/70">
                <td className="px-6 py-4">
                  <div className="font-serif font-semibold text-ink-900">Inception to Date</div>
                  <div className="text-xs text-ink-700/60">Since {formatDate(lp.joinedDate)}</div>
                </td>
                <td className="tnum px-4 py-4 text-right text-ink-700/70">{formatUSD(0)}</td>
                <td className="tnum px-4 py-4 text-right font-semibold text-ink-900">
                  {formatSignedUSD(itd.contributions)}
                </td>
                <td
                  className={`tnum px-4 py-4 text-right font-semibold ${
                    itd.allocatedPnl < 0 ? 'text-red-700' : 'text-sage-600'
                  }`}
                >
                  {formatSignedUSD(itd.allocatedPnl)}
                </td>
                <td className="tnum px-4 py-4 text-right font-semibold text-red-700/90">
                  {formatSignedUSD(-itd.mgmtFees)}
                </td>
                <td className="tnum px-4 py-4 text-right font-semibold text-red-700/90">
                  {formatSignedUSD(-itd.distributions)}
                </td>
                <td className="tnum px-6 py-4 text-right font-serif text-base font-bold text-ink-900">
                  {formatUSD(itd.closing)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-parchment-200 px-6 py-4 text-xs text-ink-700/70">
          <span>
            <span className="font-medium text-ink-900">Closing balance</span> = contributions −
            distributions − fees + allocated P&L
          </span>
          <Pill tone="muted">Exact integer minor-unit arithmetic</Pill>
          <Pill tone="gold">Folded by @gramercy/fund-admin</Pill>
        </div>
      </div>

      {/* Reconciliation strip */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <ReconTile label="Contributions" value={formatUSD(itd.contributions)} />
        <ReconTile label="Allocated P&L" value={formatSignedUSD(itd.allocatedPnl)} />
        <ReconTile label="Management Fees" value={formatUSD(itd.mgmtFees)} />
        <ReconTile label="Distributions" value={formatUSD(itd.distributions)} />
        <ReconTile label="Capital Balance" value={formatUSD(metrics.navMinor)} highlight />
      </div>
    </div>
  );
}

function ReconTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-gold-500/30 bg-gold-500/8' : 'border-parchment-200 bg-white/70'
      }`}
    >
      <p className="eyebrow">{label}</p>
      <p className="tnum mt-2 font-serif text-lg font-semibold text-ink-900">{value}</p>
    </div>
  );
}
