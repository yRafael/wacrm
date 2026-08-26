import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  iconBg?: string;
}

export default function StatCard({
  title,
  value,
  change,
  changeType = 'neutral',
  icon,
  iconBg = 'bg-primary/10',
}: StatCardProps) {
  const changeColor = {
    up: 'text-emerald-400',
    down: 'text-red-400',
    neutral: 'text-muted-foreground',
  }[changeType];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            {title}
          </p>
          <p className="text-foreground mt-1 text-3xl font-bold">{value}</p>
          {change && (
            <div
              className={`mt-1 flex items-center gap-1 text-xs font-medium ${changeColor}`}
            >
              {changeType === 'up' && <TrendingUp className="h-3 w-3" />}
              {changeType === 'down' && <TrendingDown className="h-3 w-3" />}
              <span>{change}</span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
