import { PageHeader, Panel, Pill, StatTile } from '../../components/ui';
import {
  feeLineItems,
  feeSchedule,
  balance,
  metrics,
  carryBps,
  hurdleBps,
  commitmentMinor,
} from '../../lib/seed';
import {
  formatUSD,
  formatBps,
  formatMultiple,
  formatDate,
  formatSignedUSD,
} from '../../lib/format';

export default function ReportingPage() {
  const totalFees = feeLineItems.reduce((s, f) => s + f.amountMinor, 0);

  // ILPA-style fees & expenses summary (management fees to date; other lines shown at 0
  // for this synthetic single-LP fund, presented for template completeness).
  const feesAndExpenses: { label: string; amountMinor: number; note?: string }[] = [
    {
      label: 'Management fees — gross',
      amountMinor: totalFees,
      note: `${formatBps(feeSchedule.rateBps)} p.a. on committed capital`,
    },
    { label: 'Management fee offsets / rebates', amountMinor: 0, note: 'None applied' },
    { label: 'Management fees — net', amountMinor: totalFees },
    {
      label: 'Partnership expenses allocated',
      amountMinor: 0,
      note: 'Included in P&L allocations',
    },
    {
      label: 'Carried interest accrued',
      amountMinor: 0,
      note: `${formatBps(carryBps)} over ${formatBps(hurdleBps)} pref.`,
    },
  ];

  // PCAP-style partners'-capital rollforward (inception to date).
  const pcap: { label: string; amountMinor: number; sign?: 'add' | 'less' | 'total' }[] = [
    { label: 'Beginning capital balance', amountMinor: 0 },
    { label: 'Capital contributions', amountMinor: balance.contributedMinor, sign: 'add' },
    {
      label: 'Net investment gain / (loss) allocated',
      amountMinor: balance.allocatedPnlMinor,
      sign: 'add',
    },
    { label: 'Management fees', amountMinor: -balance.feesMinor, sign: 'less' },
    { label: 'Distributions', amountMinor: -balance.distributedMinor, sign: 'less' },
    { label: 'Ending capital balance', amountMinor: balance.balanceMinor, sign: 'total' },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Reporting"
        title="Fees, Expenses & Capital"
        description="An ILPA-aligned fees & expenses summary and a partners'-capital (PCAP) rollforward for your account."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Mgmt Fees to Date" value={formatUSD(totalFees, { cents: false })} />
        <StatTile
          label="Fee Rate"
          value={formatBps(feeSchedule.rateBps)}
          sub="Per annum, committed basis"
        />
        <StatTile
          label="Carried Interest"
          value={formatBps(carryBps)}
          sub={`Over ${formatBps(hurdleBps)} preferred`}
        />
        <StatTile label="TVPI" value={formatMultiple(metrics.tvpi)} accent />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ILPA fees & expenses */}
        <Panel
          title="Fees & Expenses Summary"
          subtitle="ILPA reporting template — inception to date"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-parchment-200 text-left">
                  <th className="px-6 py-3 font-medium text-ink-700/70">Line Item</th>
                  <th className="px-6 py-3 text-right font-medium text-ink-700/70">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment-200">
                {feesAndExpenses.map((f) => {
                  const isNet = f.label === 'Management fees — net';
                  return (
                    <tr key={f.label} className={isNet ? 'bg-parchment-100/40' : ''}>
                      <td className="px-6 py-3.5">
                        <div className={isNet ? 'font-semibold text-ink-900' : 'text-ink-900'}>
                          {f.label}
                        </div>
                        {f.note ? <div className="text-xs text-ink-700/60">{f.note}</div> : null}
                      </td>
                      <td
                        className={`tnum px-6 py-3.5 text-right ${
                          isNet ? 'font-semibold text-ink-900' : 'text-ink-700/90'
                        }`}
                      >
                        {formatUSD(f.amountMinor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* PCAP rollforward */}
        <Panel title="Partners' Capital (PCAP)" subtitle="Rollforward — inception to date">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-parchment-200">
                {pcap.map((row) => {
                  const isTotal = row.sign === 'total';
                  return (
                    <tr
                      key={row.label}
                      className={isTotal ? 'border-t-2 border-ink-900/15 bg-parchment-100/60' : ''}
                    >
                      <td
                        className={`px-6 py-3.5 ${
                          isTotal ? 'font-serif font-semibold text-ink-900' : 'text-ink-900'
                        }`}
                      >
                        {row.label}
                      </td>
                      <td
                        className={`tnum px-6 py-3.5 text-right ${
                          isTotal
                            ? 'font-serif font-semibold text-ink-900'
                            : row.amountMinor < 0
                              ? 'text-red-700/90'
                              : 'text-ink-900'
                        }`}
                      >
                        {row.sign === 'add' || row.sign === 'less'
                          ? formatSignedUSD(row.amountMinor)
                          : formatUSD(row.amountMinor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* Management fee ledger */}
      <div className="mt-6">
        <Panel
          title="Management Fee Ledger"
          subtitle="Quarterly fees computed by computeMgmtFee (largest-remainder allocation)"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-parchment-200 text-left">
                  <th className="px-6 py-3 font-medium text-ink-700/70">Period</th>
                  <th className="px-4 py-3 font-medium text-ink-700/70">Charged</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-700/70">Basis</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-700/70">Rate</th>
                  <th className="px-6 py-3 text-right font-medium text-ink-700/70">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment-200">
                {feeLineItems.map((f) => (
                  <tr key={f.periodLabel} className="hover:bg-parchment-100/40">
                    <td className="px-6 py-3 font-medium text-ink-900">{f.periodLabel}</td>
                    <td className="px-4 py-3 text-ink-700/90">{formatDate(f.date)}</td>
                    <td className="tnum px-4 py-3 text-right text-ink-700/90">
                      {formatUSD(f.basisMinor, { cents: false })}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-ink-700/90">
                      {formatBps(feeSchedule.rateBps)}
                    </td>
                    <td className="tnum px-6 py-3 text-right font-medium text-ink-900">
                      {formatUSD(f.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-900/15 bg-parchment-100/70">
                  <td className="px-6 py-3.5 font-serif font-semibold text-ink-900" colSpan={4}>
                    Total Management Fees
                  </td>
                  <td className="tnum px-6 py-3.5 text-right font-serif font-semibold text-ink-900">
                    {formatUSD(totalFees)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-parchment-200 px-6 py-4">
            <Pill tone="gold">
              Basis: committed capital {formatUSD(commitmentMinor, { cents: false })}
            </Pill>
            <Pill tone="muted">Frequency: {feeSchedule.frequency}</Pill>
          </div>
        </Panel>
      </div>
    </div>
  );
}
