import Link from 'next/link';
import { PageHeader, Panel, StatTile, ProgressBar, Pill } from '../components/ui';
import { metrics, fund, lp, asOfDate, capitalCalls, distributions } from '../lib/seed';
import {
  formatUSD,
  formatUSDCompact,
  formatMultiple,
  formatPercent,
  formatDate,
} from '../lib/format';

export default function OverviewPage() {
  const recentCall = capitalCalls[capitalCalls.length - 1];
  const recentDist = distributions[distributions.length - 1];

  return (
    <div>
      <PageHeader
        eyebrow={`${fund.shortName} · Vintage ${fund.vintage}`}
        title={`Welcome, ${lp.name}`}
        description={`Your position in ${fund.name}. All figures are computed directly from your capital-account event history.`}
        aside={
          <div className="text-left sm:text-right">
            <p className="eyebrow">As of</p>
            <p className="mt-1 font-serif text-lg text-ink-900">{formatDate(asOfDate)}</p>
          </div>
        }
      />

      {/* Primary KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Commitment"
          value={formatUSD(metrics.commitmentMinor, { cents: false })}
          sub={`${lp.className}`}
        />
        <StatTile
          label="Contributed"
          value={formatUSD(metrics.contributedMinor, { cents: false })}
          sub={`${formatPercent(metrics.calledPct)} of commitment drawn`}
        />
        <StatTile
          label="Distributed"
          value={formatUSD(metrics.distributedMinor, { cents: false })}
          sub={`${formatMultiple(metrics.dpi)} DPI`}
          tone="positive"
        />
        <StatTile
          label="Current NAV"
          value={formatUSD(metrics.navMinor, { cents: false })}
          sub="Capital-account balance"
          accent
        />
      </div>

      {/* Secondary metrics */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Unfunded"
          value={formatUSD(metrics.unfundedMinor, { cents: false })}
          sub="Remaining commitment"
        />
        <StatTile
          label="Allocated P&L"
          value={formatUSD(metrics.allocatedPnlMinor, { cents: false })}
          sub="Net gains allocated to you"
          tone={metrics.allocatedPnlMinor >= 0 ? 'positive' : 'negative'}
        />
        <StatTile label="TVPI" value={formatMultiple(metrics.tvpi)} sub="Total value to paid-in" />
        <StatTile
          label="RVPI"
          value={formatMultiple(metrics.rvpi)}
          sub="Residual value to paid-in"
        />
      </div>

      {/* Commitment progress */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Commitment Deployment"
            subtitle="Capital drawn against your total commitment"
          >
            <div className="space-y-6 px-6 py-6">
              <ProgressBar
                pct={metrics.calledPct}
                label="Contributed to date"
                rightLabel={`${formatUSD(metrics.contributedMinor, { cents: false })} / ${formatUSD(
                  metrics.commitmentMinor,
                  { cents: false },
                )}`}
              />
              <div className="grid grid-cols-3 gap-4 border-t border-parchment-200 pt-5 text-sm">
                <div>
                  <p className="eyebrow">Contributed</p>
                  <p className="tnum mt-1 font-medium text-ink-900">
                    {formatUSDCompact(metrics.contributedMinor)}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Unfunded</p>
                  <p className="tnum mt-1 font-medium text-ink-900">
                    {formatUSDCompact(metrics.unfundedMinor)}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Mgmt Fees</p>
                  <p className="tnum mt-1 font-medium text-ink-900">
                    {formatUSDCompact(metrics.feesMinor)}
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="Fund Profile">
          <dl className="divide-y divide-parchment-200 px-6 text-sm">
            <ProfileRow label="Fund" value={fund.name} />
            <ProfileRow label="Strategy" value={fund.strategy} />
            <ProfileRow label="Vintage" value={String(fund.vintage)} />
            <ProfileRow label="Domicile" value={fund.domicile} />
            <ProfileRow label="Base Currency" value={fund.currency} />
            <ProfileRow label="Your Status" value={<Pill tone="sage">Active LP</Pill>} />
          </dl>
        </Panel>
      </div>

      {/* Recent activity */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Panel
          title="Latest Capital Call"
          actions={
            <Link
              href="/capital-calls"
              className="text-xs font-medium text-gold-600 hover:text-gold-700"
            >
              View all →
            </Link>
          }
        >
          {recentCall ? (
            <div className="px-6 py-5">
              <div className="flex items-baseline justify-between">
                <p className="font-serif text-xl font-semibold text-ink-900">
                  Call #{recentCall.number}
                </p>
                <p className="tnum font-serif text-xl font-semibold text-ink-900">
                  {formatUSD(recentCall.amountMinor)}
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-700/70">{recentCall.purpose}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-700/60">
                <Pill tone="muted">Due {formatDate(recentCall.dueDate)}</Pill>
                <Pill tone="sage">Funded</Pill>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Latest Distribution"
          actions={
            <Link
              href="/distributions"
              className="text-xs font-medium text-gold-600 hover:text-gold-700"
            >
              View all →
            </Link>
          }
        >
          {recentDist ? (
            <div className="px-6 py-5">
              <div className="flex items-baseline justify-between">
                <p className="font-serif text-xl font-semibold text-ink-900">
                  Distribution #{recentDist.number}
                </p>
                <p className="tnum font-serif text-xl font-semibold text-sage-600">
                  {formatUSD(recentDist.amountMinor)}
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-700/70">{recentDist.source}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-700/60">
                <Pill tone="muted">{formatDate(recentDist.date)}</Pill>
                <Pill tone="gold">{recentDist.kind === 'gain' ? 'Gain' : 'Return of Capital'}</Pill>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-ink-700/70">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
