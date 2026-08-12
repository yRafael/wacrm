'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Image as ImageIcon,
  Info,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useBranding } from '@/hooks/use-branding';
import {
  BRAND_MAX_BYTES,
  listBrandAssets,
  removeBrandAsset,
  uploadBrandAsset,
  brandAssetPathUrl,
  type BrandAssetKind,
} from '@/lib/branding/assets';
import {
  deleteBranding,
  getBranding,
  saveBranding,
} from '@/lib/branding/queries';
import {
  DEFAULT_CONFIG,
  mergeBrandingConfig,
  type BrandingConfig,
  type BrandingConfigPatch,
  type BackgroundKind,
} from '@/lib/branding/types';
import { BACKGROUND_PRESETS } from '@/lib/branding/presets';
import { SettingsPanelHead } from './settings-panel-head';
import {
  ColorField,
  ImagePickerButton,
  Segmented,
  SliderRow,
} from './personalization/controls';
import {
  BannerMock,
  FaviconMock,
  SidebarMock,
  ThreadMock,
} from './personalization/previews';

// ============================================================
// Personalização — the per-company white-label panel (migration 045).
//
// Six tabs, all driven by a single local draft (`logoPath`/`bannerPath`/
// `config`/`companyName`). Edits render live in the mockups but only hit
// the DB on "Salvar alterações" (saveBranding upsert + accounts.name).
// The whole editor is admin-gated (canEditSettings); a viewer/agent sees
// a read-only preview of the current identity + adminOnlyHint.
//
// Uploads are account-scoped and session-gated by RLS: an image is never
// served publicly — every `<img>` here (and in the app) goes through the
// /api/branding/asset proxy, which re-verifies ownership from the JWT.
// ============================================================

type TabId = 'brand' | 'colors' | 'dashboard' | 'chat' | 'gallery' | 'advanced';

/** Theme vars resolved at runtime — the fallback swatches for unset fields. */
interface ThemeDefaults {
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  primarySoft: string;
  ring: string;
  bubbleSentBg: string;
  bubbleSentText: string;
  bubbleReceivedBg: string;
  bubbleReceivedText: string;
}

const FALLBACK_THEME: ThemeDefaults = {
  primary: '#ea580c',
  primaryForeground: '#ffffff',
  primaryHover: '#f97316',
  primarySoft: '#f97316',
  ring: '#ea580c',
  bubbleSentBg: '#ea580c',
  bubbleSentText: '#ffffff',
  bubbleReceivedBg: '#e5e7eb',
  bubbleReceivedText: '#0f172a',
};

const fieldClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'border-border bg-card rounded-xl border p-4 sm:p-5',
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-foreground mb-1 text-sm font-semibold">{children}</h3>
  );
}

function CardHint({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground mb-4 text-xs">{children}</p>;
}

/**
 * Image-spec callout — the recommended size/format for each asset type,
 * so clients create the image correctly the first time. Rendered as a
 * subtle info box at the bottom of the relevant tab card.
 */
function SpecNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/60 text-muted-foreground mt-4 flex items-start gap-2 rounded-lg p-3 text-xs leading-relaxed">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-0.5">{children}</div>
    </div>
  );
}

function PresetSwatch({ css }: { css: string }) {
  return (
    <div
      aria-hidden
      className="border-border h-14 w-full rounded-lg border"
      style={{ backgroundImage: css, backgroundSize: 'cover' }}
    />
  );
}

export function PersonalizationPanel() {
  const t = useTranslations('Settings.personalization');
  const supabase = createClient();
  const { accountId, account, canEditSettings, refreshProfile } = useAuth();
  const { refreshBranding, clearOverrides } = useBranding();

  const [activeTab, setActiveTab] = useState<TabId>('brand');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<BrandAssetKind | null>(null);

  // The draft — everything the tabs edit, only persisted on save.
  const [companyName, setCompanyName] = useState('');
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [config, setConfig] = useState<BrandingConfig>(DEFAULT_CONFIG);
  const [gallery, setGallery] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeDefaults>(FALLBACK_THEME);
  const [dirty, setDirty] = useState(false);

  // Seed the draft from the DB + resolve the current theme vars. The
  // `.then()` chain keeps setState out of the effect body's synchronous
  // path (react-hooks/set-state-in-effect) — same pattern as
  // catalog-settings.
  const reload = useCallback(() => {
    if (!accountId) return Promise.resolve();
    return Promise.all([
      getBranding(supabase, accountId),
      supabase
        .from('accounts')
        .select('name')
        .eq('id', accountId)
        .maybeSingle(),
      listBrandAssets(supabase, accountId),
    ]).then(([branding, accountRow, assets]) => {
      const name = (accountRow?.data as { name?: string } | null)?.name;
      setCompanyName(name ?? '');
      setLogoPath(branding?.logo_path ?? null);
      setBannerPath(branding?.banner_path ?? null);
      setConfig(branding?.config ?? DEFAULT_CONFIG);
      setGallery(assets);
      // Resolve the CURRENTLY applied theme (the brand color overrides if
      // the company already saved one) so unset fields preview sensibly.
      const cs = getComputedStyle(document.documentElement);
      // Only accept a hex value. Derived tokens (e.g. --primary-soft from
      // a brand color) compute to `color-mix(...)` — great for CSS, but
      // invalid as an <input type="color"> value. Fall back instead.
      const read = (v: string, fb: string) => {
        const raw = cs.getPropertyValue(v).trim();
        return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : fb;
      };
      setTheme({
        primary: read('--primary', FALLBACK_THEME.primary),
        primaryForeground: read(
          '--primary-foreground',
          FALLBACK_THEME.primaryForeground
        ),
        primaryHover: read('--primary-hover', FALLBACK_THEME.primaryHover),
        primarySoft: read('--primary-soft', FALLBACK_THEME.primarySoft),
        ring: read('--ring', FALLBACK_THEME.ring),
        bubbleSentBg: read('--primary', FALLBACK_THEME.bubbleSentBg),
        bubbleSentText: read(
          '--primary-foreground',
          FALLBACK_THEME.bubbleSentText
        ),
        bubbleReceivedBg: read('--muted', FALLBACK_THEME.bubbleReceivedBg),
        bubbleReceivedText: read(
          '--foreground',
          FALLBACK_THEME.bubbleReceivedText
        ),
      });
      setLoading(false);
    });
  }, [accountId, supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshGallery = useCallback(() => {
    if (!accountId) return Promise.resolve();
    return listBrandAssets(supabase, accountId).then(setGallery);
  }, [accountId, supabase]);

  const patchConfig = useCallback((patch: BrandingConfigPatch) => {
    setConfig((c) => mergeBrandingConfig(c, patch));
    setDirty(true);
  }, []);

  // ----------------------------------------------------------
  // Uploads — account-scoped into the private bucket. Stored paths go
  // into the draft; a Cancel leaves an orphan that "Restaurar padrão"
  // cleans up (it removes every object in the folder).
  // ----------------------------------------------------------
  const assertUploadable = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('uploads.notImage'));
      return false;
    }
    if (file.size > BRAND_MAX_BYTES) {
      toast.error(t('uploads.tooLarge', { mb: BRAND_MAX_BYTES / 1024 / 1024 }));
      return false;
    }
    return true;
  };

  const upload = async (file: File, kind: BrandAssetKind) => {
    if (!accountId || !assertUploadable(file)) return;
    setBusy(kind);
    try {
      const { path } = await uploadBrandAsset(supabase, accountId, file, kind);
      if (kind === 'logo') {
        setLogoPath(path);
      } else if (kind === 'banner') {
        setBannerPath(path);
      } else if (kind === 'chat') {
        patchConfig({ chat: { background: { kind: 'image', path } } });
      }
      setDirty(true);
      if (kind === 'gallery') await refreshGallery();
    } catch (err) {
      console.warn('[branding] upload failed:', err);
      toast.error(t('uploads.failed'));
    } finally {
      setBusy(null);
    }
  };

  // ----------------------------------------------------------
  // Save / Cancel
  // ----------------------------------------------------------
  const handleSave = () => {
    if (!accountId) return;
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      toast.error(t('brand.nameRequired'));
      return;
    }
    setSaving(true);
    const nameChanged = trimmedName !== (account?.name ?? '');
    const tasks: Promise<unknown>[] = [];
    if (nameChanged) {
      // The supabase builder is a PromiseLike, not a real Promise — wrap it
      // so Promise.all sees a genuine promise (and the TS type lines up).
      tasks.push(
        Promise.resolve(
          supabase
            .from('accounts')
            .update({ name: trimmedName })
            .eq('id', accountId)
        ).then(() => undefined)
      );
    }
    Promise.all(tasks)
      .then(() =>
        saveBranding(supabase, accountId, {
          logo_path: logoPath,
          banner_path: bannerPath,
          config,
        })
      )
      .then(() => refreshBranding())
      .then(async () => {
        if (nameChanged) await refreshProfile();
        setDirty(false);
        toast.success(t('saved'));
      })
      .catch((err) => {
        console.warn('[branding] save failed:', err);
        toast.error(t('saveFailed'));
      })
      .finally(() => setSaving(false));
  };

  const handleCancel = () => {
    if (!dirty && !loading) return;
    setDirty(false);
    void reload();
  };

  // ----------------------------------------------------------
  // Restaurar padrão — remove every asset + the row, restore Fire.
  // ----------------------------------------------------------
  const handleReset = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      const paths = new Set<string>();
      if (logoPath) paths.add(logoPath);
      if (bannerPath) paths.add(bannerPath);
      if (
        config.chat.background.kind === 'image' &&
        config.chat.background.path
      ) {
        paths.add(config.chat.background.path);
      }
      for (const p of gallery) paths.add(p);
      for (const p of paths) {
        await removeBrandAsset(supabase, p).catch(() => undefined);
      }
      await deleteBranding(supabase, accountId);
      clearOverrides();
      await reload();
      await refreshBranding();
      setDirty(false);
      toast.success(t('advanced.resetDone'));
    } catch (err) {
      console.warn('[branding] reset failed:', err);
      toast.error(t('advanced.resetFailed'));
    } finally {
      setSaving(false);
    }
  };

  const bg = config.chat.background;
  const hasColor = (key: keyof typeof config.colors) =>
    Boolean(config.colors[key]);

  // ----------------------------------------------------------
  // Read-only view for viewers/agents.
  // ----------------------------------------------------------
  if (!canEditSettings) {
    return (
      <div className="space-y-6">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Card>
          <SidebarMock logoPath={logoPath} companyName={companyName} />
          <div className="mt-4">
            <ThreadMock config={config} />
          </div>
        </Card>
        <Card>
          <p className="text-muted-foreground text-xs">{t('adminOnlyHint')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <div className="overflow-x-auto">
          <TabsList className="h-9 w-full max-w-full gap-0.5 sm:w-fit">
            <TabsTrigger value="brand">{t('tabs.brand')}</TabsTrigger>
            <TabsTrigger value="colors">{t('tabs.colors')}</TabsTrigger>
            <TabsTrigger value="dashboard">{t('tabs.dashboard')}</TabsTrigger>
            <TabsTrigger value="chat">{t('tabs.chat')}</TabsTrigger>
            <TabsTrigger value="gallery">{t('tabs.gallery')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('tabs.advanced')}</TabsTrigger>
          </TabsList>
        </div>

        {/* ------------------------------------------------ Marca */}
        <TabsContent value="brand" className="space-y-6">
          <Card>
            <CardTitle>{t('brand.logoLabel')}</CardTitle>
            <CardHint>{t('brand.logoHint')}</CardHint>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="border-border bg-background w-full max-w-56 overflow-hidden rounded-xl border">
                <SidebarMock logoPath={logoPath} companyName={companyName} />
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2">
                  <ImagePickerButton
                    busy={busy === 'logo'}
                    busyLabel={t('uploads.busy')}
                    onFile={(f) => void upload(f, 'logo')}
                  >
                    {t('brand.logoUpload')}
                  </ImagePickerButton>
                  {logoPath && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        setLogoPath(null);
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="size-4" />
                      {t('brand.logoRemove')}
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('uploads.hint')}
                </p>
              </div>
            </div>
            <SpecNote>
              <p>{t('specs.logo')}</p>
              <p>{t('specs.format')}</p>
            </SpecNote>
          </Card>

          <Card>
            <CardTitle>{t('brand.nameLabel')}</CardTitle>
            <CardHint>{t('brand.nameHint')}</CardHint>
            <input
              type="text"
              value={companyName}
              disabled={saving}
              onChange={(e) => {
                setCompanyName(e.target.value);
                setDirty(true);
              }}
              placeholder="FIRE PLAY"
              className={fieldClass}
              maxLength={60}
            />
          </Card>

          <Card>
            <CardTitle>{t('brand.faviconLabel')}</CardTitle>
            <CardHint>{t('brand.faviconHint')}</CardHint>
            <FaviconMock
              primary={config.colors.primary}
              companyName={companyName}
            />
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ Cores */}
        <TabsContent value="colors" className="space-y-6">
          <Card>
            <CardTitle>{t('colors.title')}</CardTitle>
            <CardHint>{t('colors.hint')}</CardHint>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label={t('colors.primary')}
                value={config.colors.primary ?? theme.primary}
                disabled={saving}
                onChange={(hex) => patchConfig({ colors: { primary: hex } })}
              />
              <ColorField
                label={t('colors.primaryForeground')}
                value={
                  config.colors.primaryForeground ?? theme.primaryForeground
                }
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ colors: { primaryForeground: hex } })
                }
              />
              <ColorField
                label={t('colors.primaryHover')}
                value={config.colors.primaryHover ?? theme.primaryHover}
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ colors: { primaryHover: hex } })
                }
              />
              <ColorField
                label={t('colors.primarySoft')}
                value={config.colors.primarySoft ?? theme.primarySoft}
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ colors: { primarySoft: hex } })
                }
              />
              <ColorField
                label={t('colors.ring')}
                value={config.colors.ring ?? theme.ring}
                disabled={saving}
                onChange={(hex) => patchConfig({ colors: { ring: hex } })}
              />
            </div>
            <div className="border-border mt-4 flex flex-wrap gap-2 border-t pt-4">
              {hasColor('primary') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    patchConfig({ colors: { primary: undefined } })
                  }
                >
                  <X className="size-4" />
                  {t('colors.clearPrimary')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setConfig((c) => ({ ...c, colors: {} }));
                  setDirty(true);
                }}
              >
                {t('colors.resetColors')}
              </Button>
            </div>
            <p className="bg-muted/60 text-muted-foreground mt-4 rounded-lg p-3 text-xs">
              {t('colors.scopeNote')}
            </p>
          </Card>

          <Card>
            <CardTitle>{t('colors.previewTitle')}</CardTitle>
            <div className="border-border bg-background max-w-56 overflow-hidden rounded-xl border">
              <SidebarMock logoPath={logoPath} companyName={companyName} />
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ Dashboard */}
        <TabsContent value="dashboard" className="space-y-6">
          <Card>
            <CardTitle>{t('dashboard.bannerLabel')}</CardTitle>
            <CardHint>{t('dashboard.bannerHint')}</CardHint>
            <BannerMock bannerPath={bannerPath} />
            <div className="mt-4 flex items-center gap-2">
              <ImagePickerButton
                busy={busy === 'banner'}
                busyLabel={t('uploads.busy')}
                onFile={(f) => void upload(f, 'banner')}
              >
                {t('dashboard.bannerUpload')}
              </ImagePickerButton>
              {bannerPath && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setBannerPath(null);
                    setDirty(true);
                  }}
                >
                  <Trash2 className="size-4" />
                  {t('dashboard.bannerRemove')}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              {t('uploads.hint')}
            </p>
            <SpecNote>
              <p>{t('specs.banner')}</p>
              <p>{t('specs.format')}</p>
            </SpecNote>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ Chat */}
        <TabsContent value="chat" className="space-y-6">
          <Card>
            <CardTitle>{t('chat.backgroundLabel')}</CardTitle>
            <CardHint>{t('chat.backgroundHint')}</CardHint>
            <div className="space-y-5">
              <Segmented<BackgroundKind>
                value={bg.kind}
                onChange={(kind) =>
                  patchConfig({ chat: { background: { kind } } })
                }
                options={[
                  { value: 'none', label: t('chat.bgNone') },
                  { value: 'preset', label: t('chat.bgPreset') },
                  { value: 'image', label: t('chat.bgImage') },
                ]}
              />

              {bg.kind === 'preset' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {BACKGROUND_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        patchConfig({
                          chat: {
                            background: { kind: 'preset', presetId: p.id },
                          },
                        })
                      }
                      className={cn(
                        'rounded-lg border text-left transition-colors',
                        bg.presetId === p.id
                          ? 'border-primary ring-primary ring-1'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <PresetSwatch css={p.css} />
                      <span className="text-foreground block px-2 py-1.5 text-xs font-medium">
                        {t(`chat.presets.${p.nameKey}`)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {bg.kind === 'image' && (
                <div className="space-y-3">
                  <ImagePickerButton
                    busy={busy === 'chat'}
                    busyLabel={t('uploads.busy')}
                    onFile={(f) => void upload(f, 'chat')}
                  >
                    {t('chat.bgUpload')}
                  </ImagePickerButton>
                  <SpecNote>
                    <p>{t('specs.chat')}</p>
                    <p>{t('specs.format')}</p>
                  </SpecNote>
                  {bg.path && (
                    <div className="flex items-center gap-3">
                      <div className="border-border h-16 w-24 shrink-0 overflow-hidden rounded-lg border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={brandAssetPathUrl(bg.path)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() =>
                          patchConfig({
                            chat: { background: { kind: 'none' } },
                          })
                        }
                      >
                        <X className="size-4" />
                        {t('chat.bgRemove')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="border-border grid gap-x-6 gap-y-4 border-t pt-4 sm:grid-cols-2">
                <SliderRow
                  label={t('chat.opacity')}
                  value={bg.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(n) => `${Math.round(n * 100)}%`}
                  disabled={saving}
                  onChange={(opacity) =>
                    patchConfig({ chat: { background: { opacity } } })
                  }
                />
                <SliderRow
                  label={t('chat.blur')}
                  value={bg.blur}
                  min={0}
                  max={40}
                  step={1}
                  format={(n) => `${n}px`}
                  disabled={saving}
                  onChange={(blur) =>
                    patchConfig({ chat: { background: { blur } } })
                  }
                />
                <SliderRow
                  label={t('chat.scale')}
                  value={bg.scale}
                  min={1}
                  max={2}
                  step={0.05}
                  format={(n) => `${n.toFixed(2)}×`}
                  disabled={saving}
                  onChange={(scale) =>
                    patchConfig({ chat: { background: { scale } } })
                  }
                />
                <div className="space-y-1.5">
                  <label className="text-foreground text-xs font-medium">
                    {t('chat.position')}
                  </label>
                  <select
                    value={bg.position}
                    disabled={saving}
                    onChange={(e) =>
                      patchConfig({
                        chat: {
                          background: {
                            position: e.target.value as typeof bg.position,
                          },
                        },
                      })
                    }
                    className={fieldClass}
                  >
                    {(
                      ['left', 'center', 'right', 'top', 'bottom'] as const
                    ).map((pos) => (
                      <option key={pos} value={pos}>
                        {t(`chat.position_${pos}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-foreground text-xs font-medium">
                    {t('chat.overlayColor')}
                  </label>
                  <input
                    type="color"
                    value={bg.overlayColor}
                    disabled={saving}
                    onChange={(e) =>
                      patchConfig({
                        chat: { background: { overlayColor: e.target.value } },
                      })
                    }
                    className="border-border bg-muted h-9 w-full cursor-pointer rounded-lg border"
                  />
                </div>
                <SliderRow
                  label={t('chat.overlayOpacity')}
                  value={bg.overlayOpacity}
                  min={0}
                  max={0.9}
                  step={0.05}
                  format={(n) => `${Math.round(n * 100)}%`}
                  disabled={saving}
                  onChange={(overlayOpacity) =>
                    patchConfig({ chat: { background: { overlayOpacity } } })
                  }
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>{t('chat.bubblesLabel')}</CardTitle>
            <CardHint>{t('chat.bubblesHint')}</CardHint>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label={t('chat.sentBg')}
                value={config.chat.bubbles.sentBg ?? theme.bubbleSentBg}
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ chat: { bubbles: { sentBg: hex } } })
                }
              />
              <ColorField
                label={t('chat.sentText')}
                value={config.chat.bubbles.sentText ?? theme.bubbleSentText}
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ chat: { bubbles: { sentText: hex } } })
                }
              />
              <ColorField
                label={t('chat.receivedBg')}
                value={config.chat.bubbles.receivedBg ?? theme.bubbleReceivedBg}
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ chat: { bubbles: { receivedBg: hex } } })
                }
              />
              <ColorField
                label={t('chat.receivedText')}
                value={
                  config.chat.bubbles.receivedText ?? theme.bubbleReceivedText
                }
                disabled={saving}
                onChange={(hex) =>
                  patchConfig({ chat: { bubbles: { receivedText: hex } } })
                }
              />
            </div>
          </Card>

          <Card>
            <CardTitle>{t('chat.previewLabel')}</CardTitle>
            <CardHint>{t('chat.previewHint')}</CardHint>
            <ThreadMock config={config} />
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ Imagens */}
        <TabsContent value="gallery" className="space-y-6">
          <Card>
            <CardTitle>{t('gallery.title')}</CardTitle>
            <CardHint>{t('gallery.hint')}</CardHint>
            <div className="mb-4">
              <ImagePickerButton
                busy={busy === 'gallery'}
                busyLabel={t('uploads.busy')}
                onFile={(f) => void upload(f, 'gallery')}
              >
                {t('gallery.upload')}
              </ImagePickerButton>
            </div>
            <SpecNote>
              <p>{t('specs.gallery')}</p>
              <p>{t('specs.format')}</p>
            </SpecNote>
            {gallery.length === 0 ? (
              <p className="bg-muted/60 text-muted-foreground rounded-lg p-4 text-center text-xs">
                {t('gallery.empty')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {gallery.map((p) => (
                  <div
                    key={p}
                    className="border-border overflow-hidden rounded-lg border"
                  >
                    <div className="bg-muted h-20 w-full overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={brandAssetPathUrl(p)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col gap-1 p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        className="justify-start text-xs"
                        onClick={() =>
                          patchConfig({
                            chat: { background: { kind: 'image', path: p } },
                          })
                        }
                      >
                        <Sparkles className="size-3.5" />
                        {t('gallery.useAsBackground')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        className="text-muted-foreground hover:text-destructive justify-start text-xs"
                        onClick={async () => {
                          try {
                            await removeBrandAsset(supabase, p);
                            await refreshGallery();
                          } catch {
                            toast.error(t('gallery.removeFailed'));
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {t('gallery.remove')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>{t('gallery.presetsTitle')}</CardTitle>
            <CardHint>{t('gallery.presetsHint')}</CardHint>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {BACKGROUND_PRESETS.map((p) => (
                <div
                  key={p.id}
                  className="border-border overflow-hidden rounded-lg border"
                >
                  <PresetSwatch css={p.css} />
                  <div className="p-2">
                    <p className="text-foreground truncate text-xs font-medium">
                      {t(`chat.presets.${p.nameKey}`)}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      className="mt-1 w-full justify-start text-xs"
                      onClick={() =>
                        patchConfig({
                          chat: {
                            background: { kind: 'preset', presetId: p.id },
                          },
                        })
                      }
                    >
                      <Sparkles className="size-3.5" />
                      {t('gallery.useAsBackground')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ Avançado */}
        <TabsContent value="advanced">
          <Card className="border-destructive/30">
            <CardTitle>{t('advanced.title')}</CardTitle>
            <CardHint>{t('advanced.hint')}</CardHint>
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={saving}
                  />
                }
              >
                <RotateCcw className="size-4" />
                {t('advanced.resetButton')}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('advanced.resetConfirmTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('advanced.resetConfirmDescription')}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    {t('advanced.resetCancel')}
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void handleReset()}
                  >
                    {saving
                      ? t('advanced.resetBusy')
                      : t('advanced.resetConfirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky footer — Cancel / Save always reachable. */}
      <div className="border-border bg-card/95 sticky bottom-0 z-10 -mx-1 rounded-xl border p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground min-w-0 text-xs">
            {dirty ? t('unsaved') : t('savedState')}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || loading || !dirty}
              onClick={handleCancel}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || loading || !dirty}
              onClick={handleSave}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <ImageIcon className="size-3.5 shrink-0" />
        {t('privacyNote')}
      </p>
    </div>
  );
}
