import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/**
 * Page header with title, optional subtitle, and action toolbar.
 * `actions` is wrapped in `.page-header-button` automatically.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-header-button">{actions}</div>}
    </div>
  );
}
