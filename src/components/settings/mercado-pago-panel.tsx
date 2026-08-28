'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface MPCredentialsStatus {
  configured: boolean;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Settings panel for Mercado Pago credentials configuration.
 * Allows each account to store their own MP access token and webhook secret
 * for independent billing (reseller model).
 */
export function MercadoPagoPanel() {
  const t = useTranslations('Settings.mercadoPago');
  const [status, setStatus] = useState<MPCredentialsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [showForm, setShowForm] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/mercado-pago');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setShowForm(!data.configured);
      }
    } catch {
      // Silently handle — status will remain null
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/settings/mercado-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          webhook_secret: webhookSecret || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('saveError'));
        return;
      }
      toast.success(t('saved'));
      setAccessToken('');
      setWebhookSecret('');
      setShowForm(false);
      await loadStatus();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('deleteConfirm'))) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/settings/mercado-pago', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('deleteError'));
        return;
      }
      toast.success(t('deleted'));
      setShowForm(true);
      await loadStatus();
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="space-y-4">
        {/* Status card */}
        {status?.configured && !showForm && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="text-primary size-5" />
                <div>
                  <p className="text-foreground text-sm font-medium">{t('configured')}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('lastUpdated', {
                      date: status.updated_at
                        ? new Date(status.updated_at).toLocaleDateString('pt-BR')
                        : '-',
                    })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowForm(true)}
                >
                  {t('update')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Warning for resellers */}
        {!status?.configured && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-4 text-amber-500" />
              <div>
                <p className="text-foreground text-sm font-medium">{t('required')}</p>
                <p className="text-muted-foreground mt-1 text-xs">{t('requiredDescription')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        {(showForm || !status?.configured) && (
          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="mp-access-token" className="text-muted-foreground">
                  {t('accessTokenLabel')}
                </Label>
                <Input
                  id="mp-access-token"
                  type="password"
                  placeholder={t('accessTokenPlaceholder')}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  required={!status?.configured}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
                <p className="text-muted-foreground text-xs">
                  {t('accessTokenHelp')}{' '}
                  <a
                    href="https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    {t('learnMore')}
                    <ExternalLink className="inline size-3" />
                  </a>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="mp-webhook-secret" className="text-muted-foreground">
                  {t('webhookSecretLabel')}
                </Label>
                <Input
                  id="mp-webhook-secret"
                  type="password"
                  placeholder={t('webhookSecretPlaceholder')}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
                <p className="text-muted-foreground text-xs">{t('webhookSecretHelp')}</p>
              </div>

              {/* Webhook URL guidance */}
              <div className="rounded-md border border-border bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs font-medium">{t('webhookUrlLabel')}</p>
                <code className="text-foreground mt-1 block break-all text-xs">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/mercado-pago` : '/api/webhooks/mercado-pago'}
                </code>
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {t('webhookUrlHelp')}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={saving}
                className="fire-gradient-btn text-white font-medium h-10 disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </Button>
              {status?.configured && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setAccessToken('');
                    setWebhookSecret('');
                  }}
                >
                  {t('cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
