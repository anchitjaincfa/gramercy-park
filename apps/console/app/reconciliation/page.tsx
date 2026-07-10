import { PageHeader, Card, CardHeader, StatTile, Badge, TableScroll } from '@/components/ui';
import { formatUSD, formatDate } from '@/lib/format';
import { reconRows, reconSummary, type ReconStatus } from '@/lib/seed';

const statusTone: Record<ReconStatus, 'pass' | 'warn' | 'fail'> = {
  matched: 'pass',
  exception: 'warn',
  unmatched: 'fail',
};

const statusLabel: Record<ReconStatus, string> = {
  matched: 'Matched',
  exception: 'Exception',
  unmatched: 'Unmatched',
};

function signed(minor: number): string {
  return minor < 0 ? `(${formatUSD(-minor)})` : formatUSD(minor);
}

export default function ReconciliationPage() {
  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Three-way match across the bank feed, the posted ledger, and supporting documents. Exceptions and unmatched items are surfaced — never silently dropped — for an accountant to resolve."
        actions={
          <Badge tone={reconSummary.exception + reconSummary.unmatched === 0 ? 'pass' : 'warn'}>
            {reconSummary.matched}/{reconSummary.total} matched
          </Badge>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Matched" value={String(reconSummary.matched)} accent />
        <StatTile label="Exceptions" value={String(reconSummary.exception)} sub="Missing journal" />
        <StatTile
          label="Unmatched"
          value={String(reconSummary.unmatched)}
          sub="Needs classification"
        />
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader title="Three-way match" meta={`${reconRows.length} bank items`} />
          <TableScroll>
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 text-right font-medium">Bank</th>
                  <th className="px-5 py-3 text-right font-medium">Ledger</th>
                  <th className="px-5 py-3 font-medium">Document</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {reconRows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/60">
                    <td className="tnum px-5 py-3 text-slate-500">{formatDate(r.date)}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-800">{r.description}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{r.note}</div>
                    </td>
                    <td className="tnum px-5 py-3 text-right text-slate-700">
                      {signed(r.bankMinor)}
                    </td>
                    <td className="tnum px-5 py-3 text-right text-slate-700">
                      {r.ledgerMinor === null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        signed(r.ledgerMinor)
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {r.documentRef ? (
                        <span className="font-mono text-[11px] text-slate-500">
                          {r.documentRef}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Open exceptions.</span> The Apex fund-admin invoice has a
          bank debit and a document but no posted journal — the AI has prepared a matching journal
          entry, waiting in the review queue. The small banking fee is unmatched and awaits
          classification.
        </p>
      </div>
    </div>
  );
}
