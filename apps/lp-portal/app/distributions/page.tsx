import { PageHeader, Panel, Pill, StatTile } from '../../components/ui';
import { distributions, metrics } from '../../lib/seed';
import { formatUSD, formatDate, formatMultiple } from '../../lib/format';

const kindLabel: Record<string, string> = {
  return_of_capital: 'Return of Capital',
  gain: 'Gain',
};

export default function DistributionsPage() {
  const total = distributions.reduce((s, d) => s + d.amountMinor, 0);
  const recallable = distributions
    .filter((d) => d.recallable)
    .reduce((s, d) => s + d.amountMinor, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Cash Returned"
        title="Distributions"
        description="Proceeds returned to you from realizations, recapitalizations, and income."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Distributions" value={String(distributions.length)} />
        <StatTile
          label="Total Distributed"
          value={formatUSD(total, { cents: false })}
          tone="positive"
        />
        <StatTile
          label="Recallable"
          value={formatUSD(recallable, { cents: false })}
          sub="Subject to recall by the GP"
        />
        <StatTile
          label="DPI"
          value={formatMultiple(metrics.dpi)}
          sub="Distributed to paid-in"
          accent
        />
      </div>

      <Panel title="Distribution History" subtitle="Most recent last">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-parchment-200 text-left">
                <th className="px-6 py-3 font-medium text-ink-700/70">No.</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Date</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Type</th>
                <th className="px-4 py-3 font-medium text-ink-700/70">Source</th>
                <th className="px-4 py-3 text-right font-medium text-ink-700/70">Recallable</th>
                <th className="px-6 py-3 text-right font-medium text-ink-700/70">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment-200">
              {distributions.map((d) => (
                <tr key={d.id} className="hover:bg-parchment-100/40">
                  <td className="px-6 py-3.5 font-medium text-ink-900">#{d.number}</td>
                  <td className="px-4 py-3.5 text-ink-700/90">{formatDate(d.date)}</td>
                  <td className="px-4 py-3.5">
                    <Pill tone={d.kind === 'gain' ? 'gold' : 'muted'}>{kindLabel[d.kind]}</Pill>
                  </td>
                  <td className="px-4 py-3.5 text-ink-700/90">{d.source}</td>
                  <td className="px-4 py-3.5 text-right text-ink-700/90">
                    {d.recallable ? 'Yes' : 'No'}
                  </td>
                  <td className="tnum px-6 py-3.5 text-right font-medium text-sage-600">
                    {formatUSD(d.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900/15 bg-parchment-100/70">
                <td className="px-6 py-3.5 font-serif font-semibold text-ink-900" colSpan={5}>
                  Total Distributed
                </td>
                <td className="tnum px-6 py-3.5 text-right font-serif font-semibold text-ink-900">
                  {formatUSD(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
}
