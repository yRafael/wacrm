'use client';

import { MessageSquareText } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Placeholder for the legacy Meta message-template manager.
 *
 * This workspace talks to WhatsApp through Baileys (WhatsApp Web), so
 * Meta's approval-based message templates don't apply — every send is
 * manual from the composer. Reusable canned replies live under Quick
 * Replies. The Meta-backed TemplateManager stays in the repo (dormant)
 * for a future phase that might reintroduce the official API.
 */
export function TemplatesPlaceholder() {
  const t = useTranslations('Settings.templatesPlaceholder');
  const tSections = useTranslations('Settings.sections');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={tSections('templates')}
        description={t('description')}
      />
      <Alert className="border-border bg-card">
        <MessageSquareText className="size-4" />
        <AlertTitle className="text-foreground">{t('title')}</AlertTitle>
        <AlertDescription className="text-muted-foreground">{t('body')}</AlertDescription>
      </Alert>
    </section>
  );
}
