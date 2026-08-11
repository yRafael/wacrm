'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';
import { GatedButton } from '@/components/ui/gated-button';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Passed to the manual action buttons so read-only roles see a tooltip. */
  canAct?: boolean;
  /** Manual [Em Teste] — moves the deal to the "Em Teste" stage. */
  onEmTeste?: (deal: Deal) => void;
  /** Manual [Registrar pagamento] — opens the payment dialog. */
  onRegisterPayment?: (deal: Deal) => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || '?').trim();
  if (!source) return '?';
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  canAct = true,
  onEmTeste,
  onRegisterPayment,
}: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;

  // The manual actions only make sense while the deal is still open and
  // the card isn't being dragged as an overlay.
  const inEmTeste = stage?.name.toLowerCase() === 'em teste';
  const inConvertido = stage?.name.toLowerCase() === 'convertido';
  const showActions =
    !isOverlay &&
    deal.status === 'open' &&
    (!!onEmTeste || !!onRegisterPayment);

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      onKeyDown={(e) => {
        if (isOverlay) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group border-border/50 bg-muted/70 focus-visible:ring-primary/40 relative w-full cursor-pointer rounded-xl border py-3 pr-3 pl-4 text-left shadow-sm transition-all outline-none focus-visible:ring-2 ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-border hover:bg-muted hover:-translate-y-0.5 hover:shadow-lg'
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="text-foreground flex-1 text-sm leading-snug font-semibold break-words">
          {deal.title}
        </h4>
        {deal.status === 'won' && (
          <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
            <Check className="h-3 w-3" />
            {t('won')}
          </span>
        )}
        {deal.status === 'lost' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t('lost')}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="bg-muted text-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {contactLabel}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-primary text-sm font-bold">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}

      {/* Manual stage-advance actions — [Em Teste] and [Registrar pagamento].
          Wrapped in stopPropagation so clicking a button never opens the deal
          editor underneath. Clicking inside the row is fine: the buttons'
          own onClick already stopPropagation, and the row itself is inert. */}
      {showActions && (
        <div
          className="border-border/60 mt-2 flex items-center gap-1.5 border-t pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {!inEmTeste && onEmTeste && (
            <GatedButton
              canAct={canAct}
              gateReason="mover leads para Em Teste"
              variant="outline"
              size="sm"
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground h-6 flex-1 bg-transparent px-1.5 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                onEmTeste(deal);
              }}
            >
              {t('emTeste')}
            </GatedButton>
          )}
          {!inConvertido && onRegisterPayment && (
            <GatedButton
              canAct={canAct}
              gateReason="registrar pagamentos"
              variant="outline"
              size="sm"
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground h-6 flex-1 bg-transparent px-1.5 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                onRegisterPayment(deal);
              }}
            >
              {t('registerPayment')}
            </GatedButton>
          )}
        </div>
      )}
    </div>
  );
}
