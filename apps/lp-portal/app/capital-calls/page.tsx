import { PageHeader, Panel, Pill, StatTile } from '../../components/ui';
import { capitalCalls, metrics, commitmentMinor } from '../../lib/seed';
import { formatUSD, formatDate, formatPercent } from '../../lib/format';

export default function CapitalCallsPage() {
  const totalCalled = capitalCalls.reduce((s, c) => s + c.amountMinor, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Drawdowns"
        title="Capital Calls"
        description="Notices issued against your commitment. Contributions flow directly into your capital account."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Notices Issued" value={String(capitalCalls.length)} />
        <StatTile
          label="Total Called"
          value={formatUSD(totalCalled, { cents: false })}
          sub={`${formatPercent(totalCalled / commitmentMinor)} of commitment`}
        />
        <StatTile
          label="Unfunded"
          value={formatUSD(metrics.unfundedMinor, { cents: false })}
          sub="Available to call"
        />
        <StatTile label="Commitment" value={formatUSD(commitmentMinor, { cents: false })} accent />
      </div>

      <Panel title="Call Notices" subtitle="Most recent last">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-parchment-200 text-left">
                <th className="px-6 py-3 font-medium text-ink-700/70">No.</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Call Date</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Due Date</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Purpose</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">% of Commit</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Amount</th>
                <th className="px-6 py-3 text-right font-medium text-ink-700/70">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment-200">
              {capitalCalls.map((c) => (
                <tr key={c.id} className="hover:bg-parchment-100/40">
                  <td className="px-6 py-3.5 font-medium text-ink-900">#{c.number}</td>
                  <td className="px-4 py-3.5 text-ink-700/90">{formatDate(c.callDate)}</td>
                  <td className="px-4 py-3.5 text-ink-700/90">{formatDate(c.dueDate)}</td>
                  <td className="px-4 py-3.5 text-ink-700/90">{c.purpose}</td>
                  <td className="tnum px-4 py-3.5 text-right text-ink-700/90">
                    {formatPercent(c.pctOfCommitment, 0)}
                  </td>
                  <td className="tnum px-4 py-3.5 text-right font-medium text-ink-900">
                    {formatUSD(c.amountMinor)}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Pill tone={c.status === 'funded' ? 'sage' : 'gold'}>
                      {c.status === 'funded' ? 'Funded' : 'Due'}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900/15 bg-parchment-100/70">
                <td className="px-6 py-3.5 font-serif font-semibold text-ink-900" colSpan={5}>
                  Total Contributed
                </td>
                <td className="tnum px-4 py-3.5 text-right font-serif font-semibold text-ink-900">
                  {formatUSD(totalCalled)}
                </td>
                <td className="px-6 py-3.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
}
