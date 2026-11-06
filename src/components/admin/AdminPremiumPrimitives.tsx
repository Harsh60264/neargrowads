import type { ReactNode } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';

export interface AdminPremiumModuleFrameProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}

export function AdminPremiumModuleFrame({
  eyebrow,
  title,
  description,
  action,
  children,
}: AdminPremiumModuleFrameProps) {
  return (
    <section className="premium-module-frame" data-premium-module={eyebrow.toLowerCase().replaceAll(' ', '-')}>
      <header className="premium-module-header">
        <div className="premium-module-heading">
          <span className="premium-module-eyebrow"><Sparkles aria-hidden="true" /> {eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action && <div className="premium-module-action">{action}</div>}
        <ArrowUpRight className="premium-module-arrow" aria-hidden="true" />
      </header>
      <div className="premium-module-body">{children}</div>
    </section>
  );
}

export function AdminPremiumStat({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'success' | 'warning' | 'accent';
}) {
  return (
    <article className={`premium-stat premium-stat-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </article>
  );
}

export function AdminPremiumBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={`premium-badge premium-badge-${tone}`}>{children}</span>;
}
