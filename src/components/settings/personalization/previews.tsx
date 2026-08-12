'use client';

/**
 * Live preview mockups for the Personalização panel. Each one mirrors the
 * real surface it represents (sidebar logo row, dashboard banner, chat
 * thread) but renders entirely from the draft config with inline styles,
 * so edits reflect instantly without touching the document theme.
 *
 * All of these are self-contained — they render the FIRE identity via CSS
 * vars when the draft has no branding, and the company identity when it
 * does. Keeping them dumb (pure props → JSX) makes them easy to eyeball
 * and impossible to accidentally read a live asset from the wrong account.
 */

import { FlameMascot } from '@/components/brand/flame-mascot';
import { resolveBackgroundCss } from '@/lib/branding/presets';
import type { BrandingConfig } from '@/lib/branding/types';
import { brandAssetPathUrl, brandAssetUrl } from '@/lib/branding/assets';

// ------------------------------------------------------------
// Sidebar logo row mock — the two-box mini at the top of a card.
// ------------------------------------------------------------

export function SidebarMock({
  logoPath,
  companyName,
}: {
  logoPath: string | null;
  companyName: string;
}) {
  return (
    <div className="border-border bg-card flex h-14 items-center gap-2 border-b px-3">
      <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        {logoPath ? (
          // Brand assets are session-gated — the mock hits the same proxy
          // the real sidebar will use, so what you preview is what you get.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brandAssetPathUrl(logoPath)}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <FlameMascot size={22} animated={false} ariaLabel="" />
        )}
      </div>
      <span className="from-flame-1 to-flame-3 truncate bg-gradient-to-r bg-clip-text text-sm font-bold tracking-wide text-transparent">
        {companyName.trim() ? companyName.trim() : 'FIRE PLAY'}
      </span>
    </div>
  );
}

// ------------------------------------------------------------
// Favicon mock — the company monogram the /icon route will render.
// ------------------------------------------------------------

export function FaviconMock({
  primary,
  companyName,
}: {
  primary: string | undefined;
  companyName: string;
}) {
  const bg = primary ?? '#ea580c'; // fire primary fallback
  const initial = companyName.trim().charAt(0).toUpperCase() || 'F';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-extrabold text-white"
        style={{ background: bg }}
      >
        {initial}
      </div>
      <span className="text-muted-foreground text-[10px]">
        {companyName.trim() || 'FIRE PLAY'}
      </span>
    </div>
  );
}

// ------------------------------------------------------------
// Dashboard banner mock — sits above the FireHero greeting.
// ------------------------------------------------------------

export function BannerMock({ bannerPath }: { bannerPath: string | null }) {
  if (!bannerPath) {
    return (
      <div className="border-border bg-muted/40 flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed">
        <span className="text-muted-foreground text-xs">
          Nenhum banner definido
        </span>
        <span className="text-muted-foreground/70 text-[10px]">
          O dashboard fica como está hoje
        </span>
      </div>
    );
  }
  // Same natural aspect-ratio as the real banner — height follows the
  // uploaded image, so the preview never crops either.
  return (
    <div className="border-border relative w-full overflow-hidden rounded-xl border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brandAssetPathUrl(bannerPath)}
        alt=""
        className="block h-auto max-h-[420px] w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
      <div className="pointer-events-none absolute bottom-3 left-4">
        <p className="text-sm font-semibold text-white">Bem-vindo!</p>
        <p className="text-xs text-white/80">Sua operação em um só lugar</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Chat thread mock — the background layer + two bubbles, so
// legibility is checked right in the tab.
// ------------------------------------------------------------

const MOCK_MESSAGES = [
  { sent: false, text: 'Olá! Quero assinar o plano família.' },
  { sent: true, text: 'Perfeito, João! Já ativei aqui. 🎉' },
];

export function ThreadMock({ config }: { config: BrandingConfig }) {
  const bg = config.chat.background;
  const css = resolveBackgroundCss(bg);
  const sent = config.chat.bubbles;
  const bubbleDefs = {
    sentBg: sent.sentBg ?? 'var(--primary)',
    sentText: sent.sentText ?? 'var(--primary-foreground)',
    receivedBg: sent.receivedBg ?? 'var(--muted)',
    receivedText: sent.receivedText ?? 'var(--foreground)',
  };

  return (
    <div className="border-border bg-card relative flex h-56 flex-col justify-end overflow-hidden rounded-xl border p-3">
      {/* Background layer — mirrors ChatBackdrop in the real thread. */}
      {css && bg.kind !== 'none' ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: css,
            backgroundSize:
              bg.kind === 'preset' && css.includes('url(') ? 'auto' : 'cover',
            backgroundPosition: bg.position,
            backgroundRepeat:
              css.startsWith('url(') || css.includes(') 0 0 /')
                ? 'repeat'
                : 'no-repeat',
            filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
            transform: bg.scale !== 1 ? `scale(${bg.scale})` : undefined,
            opacity: bg.opacity,
          }}
        />
      ) : null}

      {/* Scrim above the image, below the messages — guarantees contrast. */}
      {css && bg.kind !== 'none' && bg.overlayOpacity > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: bg.overlayColor,
            opacity: bg.overlayOpacity,
          }}
        />
      ) : null}

      {/* Messages — always on top (relative z-10, as in the thread). */}
      <div className="relative z-10 flex flex-col gap-2">
        {MOCK_MESSAGES.map((m, i) => (
          <div
            key={i}
            className="flex flex-col items-start"
            style={{ alignItems: m.sent ? 'flex-end' : 'flex-start' }}
          >
            <div
              className="max-w-[85%] rounded-2xl px-3 py-1.5 text-xs"
              style={
                m.sent
                  ? {
                      background: bubbleDefs.sentBg,
                      color: bubbleDefs.sentText,
                      borderBottomRightRadius: 4,
                    }
                  : {
                      background: bubbleDefs.receivedBg,
                      color: bubbleDefs.receivedText,
                      borderBottomLeftRadius: 4,
                    }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Convenience re-export for the chat-background proxy preview.
export function brandChatBackgroundUrl(): string {
  return brandAssetUrl('chat');
}
