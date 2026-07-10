import { PageHeader, Card, CardHeader, StatTile, Badge, TableScroll } from '@/components/ui';
import { formatUSD, formatDate } from '@/lib/format';
import {
  capitalCall,
  commitments,
  priorCalledByLp,
  lpsById,
  checkResults,
  checkSummary,
  callPostable,
} from '@/lib/seed';

const statusTone = { pass: 'pass', warn: 'warn', fail: 'fail' } as const;

export default function CapitalCallsPage() {
  const commitmentByLp = Object.fromEntries(commitments.map((c) => [c.lpId, c.amountMinor]));

  const rows = capitalCall.allocations
    .filter((a) => a.kind === 'contribution')
    .map((a) => {
      const committed = commitmentByLp[a.lpId] ?? 0;
      const prior = priorCalledByLp[a.lpId] ?? 0;
      const uncalledBefore = committed - prior;
      return {
        lpId: a.lpId,
        name: lpsById[a.lpId]?.name ?? a.lpId,
        committed,
        prior,
        uncalledBefore,
        thisCall: a.amountMinor,
        uncalledAfter: uncalledBefore - a.amountMinor,
      };
    })
    .sort((x, y) => y.thisCall - x.thisCall);

  return (
    <div>
      <PageHeader
        title="Capital Calls"
        subtitle={`Capital call #${capitalCall.number} — pro-rata to each LP's uncalled commitment, allocated with the largest-remainder method so the parts sum exactly to the total.`}
        actions={
          <Badge tone={callPostable ? 'pass' : 'fail'}>
            {callPostable ? 'All checks pass — ready to post' : 'Blocked'}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Call total" value={formatUSD(capitalCall.totalMinor)} accent />
        <StatTile label="Call date" value={formatDate(capitalCall.callDate)} />
        <StatTile label="Due date" value={formatDate(capitalCall.dueDate)} sub="10-day notice" />
        <StatTile
          label="Health checks"
          value={`${checkSummary.pass}/${checkSummary.total}`}
          sub={`${checkSummary.warn} warn · ${checkSummary.fail} fail`}
        />
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Purpose</div>
        <p className="mt-1 text-sm text-slate-700">{capitalCall.purpose}</p>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader title="Per-LP allocation" meta={`${rows.length} limited partners`} />
          <TableScroll>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Limited partner</th>
                  <th className="px-5 py-3 text-right font-medium">Commitment</th>
                  <th className="px-5 py-3 text-right font-medium">Prior called</th>
                  <th className="px-5 py-3 text-right font-medium">Uncalled</th>
                  <th className="px-5 py-3 text-right font-medium">This call</th>
                  <th className="px-5 py-3 text-right font-medium">Uncalled after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.lpId} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="tnum px-5 py-3 text-right text-slate-600">
                      {formatUSD(r.committed)}
                    </td>
                    <td className="tnum px-5 py-3 text-right text-slate-500">
                      {formatUSD(r.prior)}
                    </td>
                    <td className="tnum px-5 py-3 text-right text-slate-500">
                      {formatUSD(r.uncalledBefore)}
                    </td>
                    <td className="tnum px-5 py-3 text-right font-semibold text-accent-700">
                      {formatUSD(r.thisCall)}
                    </td>
                    <td className="tnum px-5 py-3 text-right text-slate-500">
                      {formatUSD(r.uncalledAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-5 py-3 text-slate-700">Total</td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(rows.reduce((s, r) => s + r.committed, 0))}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(rows.reduce((s, r) => s + r.prior, 0))}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(rows.reduce((s, r) => s + r.uncalledBefore, 0))}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-accent-700">
                    {formatUSD(rows.reduce((s, r) => s + r.thisCall, 0))}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-slate-700">
                    {formatUSD(rows.reduce((s, r) => s + r.uncalledAfter, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Card>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader
            title="Pre-post health checks"
            meta={
              <span>
                <span className="text-accent-700">{checkSummary.pass} pass</span> ·{' '}
                <span className="text-amber-600">{checkSummary.warn} warn</span> ·{' '}
                <span className="text-rose-600">{checkSummary.fail} fail</span>
              </span>
            }
          />
          <div className="px-5 py-4">
            <p className="mb-4 text-sm text-slate-500">
              A capital call passes a pipeline of {checkSummary.total} composable, deterministic
              checks before it can post. A call is postable iff no check fails; warnings are
              advisory.
            </p>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
              {checkResults.map((r) => (
                <li key={r.code} className="flex items-start gap-2.5 py-1">
                  <span className="mt-0.5">
                    <Badge tone={statusTone[r.status]}>{r.status}</Badge>
                  </span>
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] text-slate-500">{r.code}</span>
                    <span className="block text-xs text-slate-500">{r.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
