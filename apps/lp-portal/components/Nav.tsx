'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/capital-account', label: 'Capital Account' },
  { href: '/capital-calls', label: 'Capital Calls' },
  { href: '/distributions', label: 'Distributions' },
  { href: '/reporting', label: 'Reporting' },
  { href: '/documents', label: 'Documents' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {links.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-gold-500/15 font-medium text-gold-400'
                : 'text-parchment-200/75 hover:bg-white/5 hover:text-parchment'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
