import { PageHeader, Panel, Pill } from '../../components/ui';
import { fund, lp } from '../../lib/seed';
import { formatDate } from '../../lib/format';

type DocKind = 'Statement' | 'Notice' | 'Tax' | 'Report' | 'Legal';

interface DocRow {
  id: string;
  title: string;
  kind: DocKind;
  period: string;
  date: string;
  ext: string;
}

const documents: DocRow[] = [
  {
    id: 'd1',
    title: 'Capital Account Statement — Q2 2025',
    kind: 'Statement',
    period: 'Q2 2025',
    date: '2025-07-15',
    ext: 'PDF',
  },
  {
    id: 'd2',
    title: 'Distribution Notice #3 — Halcyon Diagnostics',
    kind: 'Notice',
    period: 'Jun 2025',
    date: '2025-06-30',
    ext: 'PDF',
  },
  {
    id: 'd3',
    title: 'Capital Call Notice #5',
    kind: 'Notice',
    period: 'Mar 2025',
    date: '2025-03-17',
    ext: 'PDF',
  },
  {
    id: 'd4',
    title: 'Schedule K-1 — Tax Year 2024',
    kind: 'Tax',
    period: 'FY 2024',
    date: '2025-03-10',
    ext: 'PDF',
  },
  {
    id: 'd5',
    title: 'Annual Report & Audited Financials — FY 2024',
    kind: 'Report',
    period: 'FY 2024',
    date: '2025-02-28',
    ext: 'PDF',
  },
  {
    id: 'd6',
    title: 'Capital Account Statement — Q4 2024',
    kind: 'Statement',
    period: 'Q4 2024',
    date: '2025-01-15',
    ext: 'PDF',
  },
  {
    id: 'd7',
    title: 'Distribution Notice #2 — Meridian Secondary',
    kind: 'Notice',
    period: 'Dec 2024',
    date: '2024-12-31',
    ext: 'PDF',
  },
  {
    id: 'd8',
    title: 'Schedule K-1 — Tax Year 2023',
    kind: 'Tax',
    period: 'FY 2023',
    date: '2024-03-12',
    ext: 'PDF',
  },
  {
    id: 'd9',
    title: 'Subscription Agreement & Side Letter',
    kind: 'Legal',
    period: 'Feb 2023',
    date: '2023-02-01',
    ext: 'PDF',
  },
  {
    id: 'd10',
    title: 'Limited Partnership Agreement (LPA)',
    kind: 'Legal',
    period: 'Jan 2023',
    date: '2023-01-10',
    ext: 'PDF',
  },
];

const kindTone: Record<DocKind, 'gold' | 'sage' | 'muted' | 'neutral'> = {
  Statement: 'gold',
  Notice: 'neutral',
  Tax: 'sage',
  Report: 'gold',
  Legal: 'muted',
};

export default function DocumentsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Document Vault"
        title="Documents"
        description={`Statements, notices, tax forms, and fund agreements for ${lp.name} in ${fund.name}.`}
      />

      <Panel title="Your Documents" subtitle={`${documents.length} files · most recent first`}>
        <ul className="divide-y divide-parchment-200">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-parchment-100/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink-900/5 text-[0.6rem] font-semibold tracking-wide text-ink-700/70 ring-1 ring-inset ring-ink-900/10">
                {doc.ext}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-900">{doc.title}</p>
                <p className="text-xs text-ink-700/60">
                  {doc.period} · {formatDate(doc.date)}
                </p>
              </div>
              <Pill tone={kindTone[doc.kind]}>{doc.kind}</Pill>
              <span
                aria-hidden
                className="hidden text-sm font-medium text-gold-600 sm:inline"
                title="Download (placeholder)"
              >
                Download ↓
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="mt-4 px-1 text-xs text-ink-700/50">
        Document links are visual placeholders in this educational study — no files are served.
      </p>
    </div>
  );
}
