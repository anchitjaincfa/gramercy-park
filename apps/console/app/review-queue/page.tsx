import type { ReactNode } from 'react';
import { PageHeader, Card, Badge, TableScroll } from '@/components/ui';
import { formatUSD, formatConfidence } from '@/lib/format';
import { proposals } from '@/lib/seed';
import type {
  Proposal,
  ProposalKind,
  ProposedJournalEntry,
  ProposedReconciliationMatch,
  ProposedKpi,
  EvidenceCitation,
} from '@gramercy/agents';

const kindMeta: Record<ProposalKind, { label: string; tone: 'accent' | 'info' | 'neutral' }> = {
  journal_entry: { label: 'Journal entry', tone: 'accent' },
  reconciliation_match: { label: 'Reconciliation match', tone: 'info' },
  kpi: { label: 'KPI reconciliation', tone: 'neutral' },
  lp_reply: { label: 'LP reply', tone: 'neutral' },
};

function confidenceTone(c: number): 'pass' | 'warn' | 'fail' {
  if (c >= 0.9) return 'pass';
  if (c >= 0.75) return 'warn';
  return 'fail';
}

function PayloadSummary({ proposal }: { proposal: Proposal<ProposalKind, unknown> }) {
  if (proposal.kind === 'journal_entry') {
    const p = proposal.payload as ProposedJournalEntry;
    return (
      <div>
        <p className="mb-3 text-sm text-slate-600">{p.memo}</p>
        <TableScroll>
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">Side</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4">
                    <span className="tnum font-mono text-xs text-slate-500">{l.accountCode}</span>
                    <span className="ml-2 text-slate-400">{l.rationale}</span>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge tone={l.side === 'debit' ? 'info' : 'neutral'}>{l.side}</Badge>
                  </td>
                  <td className="tnum py-2 text-right font-medium text-slate-800">
                    {formatUSD(l.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    );
  }

  if (proposal.kind === 'reconciliation_match') {
    const p = proposal.payload as ProposedReconciliationMatch;
    return (
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Bank transaction" value={p.bankTransactionId} mono />
          <Field label="Ledger entry" value={p.ledgerEntryId ?? '—'} mono />
          <Field label="Match status" value={<Badge tone="pass">{p.status}</Badge>} />
        </div>
        <p className="text-slate-600">{p.rationale}</p>
      </div>
    );
  }

  if (proposal.kind === 'kpi') {
    const p = proposal.payload as ProposedKpi;
    return (
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Field label="Metric" value={`${p.metric} · ${p.period}`} />
          <Field
            label="Reconciled value"
            value={<span className="font-semibold text-slate-800">{p.reconciledValue}</span>}
          />
        </div>
        <TableScroll>
          <table className="w-full min-w-[360px] text-sm">
            <tbody className="divide-y divide-slate-50">
              {p.sources.map((s, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4 text-slate-500">{s.source}</td>
                  <td className="tnum py-2 text-right font-medium text-slate-800">{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="text-slate-600">{p.rationale}</p>
      </div>
    );
  }

  return <p className="text-sm text-slate-600">{JSON.stringify(proposal.payload)}</p>;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function Evidence({ citations }: { citations: readonly EvidenceCitation[] }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/70 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Evidence · source traceability
      </div>
      <ul className="space-y-2">
        {citations.map((c, i) => (
          <li key={i} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-accent-700">{c.field}</span>
              <span className="text-slate-400">←</span>
              <span className="font-mono text-[11px] text-slate-500">{c.sourceRef}</span>
            </div>
            <blockquote className="mt-1 border-l-2 border-slate-300 pl-3 italic text-slate-500">
              “{c.quote}”
            </blockquote>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <div>
      <PageHeader
        title="Review Queue"
        subtitle="AI prepares, expert accountants review. Every proposal below is propose-only — it carries full source traceability and cannot touch the ledger until a human approves it."
        actions={<Badge tone="accent">{proposals.length} pending</Badge>}
      />

      <div className="mb-6 rounded-xl border border-accent-200 bg-accent-50 px-5 py-4">
        <p className="text-sm text-accent-800">
          <span className="font-semibold">The safety boundary.</span> Agents produce typed{' '}
          <span className="font-mono text-xs">Proposal</span> records with evidence citations, model
          provenance, and a confidence signal. Approval — replayed through a deterministic domain
          service — is the only path to a posted journal, and every action writes an audit event.
        </p>
      </div>

      <div className="space-y-5">
        {proposals.map((proposal, idx) => {
          const meta = kindMeta[proposal.kind];
          return (
            <Card key={idx}>
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <Badge tone={confidenceTone(proposal.confidence)}>
                      {formatConfidence(proposal.confidence)} confidence
                    </Badge>
                    <span className="font-mono text-[11px] text-slate-400">
                      {proposal.createdByAgent} · {proposal.model} · {proposal.promptVersion}
                    </span>
                  </div>

                  <PayloadSummary proposal={proposal} />
                  <Evidence citations={proposal.evidence} />
                </div>

                <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-700"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Approve / Reject are illustrative in this study build — no proposal posts to the ledger.
      </p>
    </div>
  );
}
