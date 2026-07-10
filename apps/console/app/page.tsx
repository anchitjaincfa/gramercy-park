import Link from 'next/link';
import { PageHeader, StatTile, Card, CardHeader, Badge } from '@/components/ui';
import { formatUSDCompact, formatUSD, formatDate } from '@/lib/format';
import {
  navTotalMinor,
  lps,
  uncalledCommitmentMinor,
  totalCommittedMinor,
  proposals,
  fund,
  recentActivity,
  portfolio,
  checkSummary,
  reconSummary,
} from '@/lib/seed';

const tagTone: Record<string, 'call' | 'nav' | 'proposal' | 'portfolio' | 'recon'> = {
  call: 'call',
  nav: 'nav',
  proposal: 'proposal',
  portfolio: 'portfolio',
  recon: 'recon',
};

const tagLabel: Record<string, string> = {
  call: 'Capital call',
  nav: 'NAV',
  proposal: 'AI proposal',
  portfolio: 'Portfolio',
  recon: 'Reconciliation',
};

export default function DashboardPage() {
  const activeLps = lps.filter((l) => l.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="Fund Dashboard"
        subtitle={`${fund.name} — a live read of the fund's position, computed from the posted general ledger and the deterministic fund-admin engine.`}
        actions={
          <Link
            href="/review-queue"
            className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-700"
          >
            {proposals.length} proposals to review
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          label="Net asset value"
          value={formatUSDCompact(navTotalMinor)}
          sub={`As of ${formatDate(fund.asOf)}`}
          accent
        />
        <StatTile
          label="Active LPs"
          value={String(activeLps)}
          sub={`${lps.length} total investors`}
        />
        <StatTile
          label="Uncalled commitment"
          value={formatUSDCompact(uncalledCommitmentMinor)}
          sub={`of ${formatUSDCompact(totalCommittedMinor)} committed`}
        />
        <StatTile
          label="Portfolio fair value"
          value={formatUSDCompact(portfolio.totalFairValueMinor)}
          sub={`${portfolio.positions.length} active positions`}
        />
        <StatTile
          label="Pending proposals"
          value={String(proposals.length)}
          sub="Awaiting human review"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" meta={`${recentActivity.length} events`} />
          <ul className="divide-y divide-slate-100">
            {recentActivity.map((item, i) => (
              <li key={i} className="flex items-start gap-4 px-5 py-4">
                <div className="tnum w-24 shrink-0 pt-0.5 text-xs font-medium text-slate-400">
                  {formatDate(item.date)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{item.title}</span>
                    <Badge tone="neutral">{tagLabel[tagTone[item.tag]]}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Capital call #2 readiness" />
            <div className="px-5 py-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="tnum text-3xl font-semibold text-accent-700">
                    {checkSummary.pass}
                    <span className="text-lg text-slate-400">/{checkSummary.total}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">pre-post checks passing</div>
                </div>
                <Badge tone={checkSummary.fail === 0 ? 'pass' : 'fail'}>
                  {checkSummary.fail === 0 ? 'Ready to post' : 'Blocked'}
                </Badge>
              </div>
              <Link
                href="/capital-calls"
                className="mt-4 inline-block text-xs font-medium text-accent-700 hover:underline"
              >
                View allocation & checks →
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Reconciliation" />
            <div className="px-5 py-4 text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">Matched</span>
                <span className="tnum font-medium text-slate-800">{reconSummary.matched}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">Exceptions</span>
                <span className="tnum font-medium text-amber-600">{reconSummary.exception}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">Unmatched</span>
                <span className="tnum font-medium text-rose-600">{reconSummary.unmatched}</span>
              </div>
              <Link
                href="/reconciliation"
                className="mt-3 inline-block text-xs font-medium text-accent-700 hover:underline"
              >
                Open three-way match →
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Total committed capital {formatUSD(totalCommittedMinor)} across {lps.length} limited
        partners.
      </p>
    </div>
  );
}
