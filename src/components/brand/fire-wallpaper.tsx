'use client';

// ============================================================
// FireWallpaper — fundo de marca para as telas de auth.
//
// Não é funcionalidade: é a identidade da marca no fundo do
// login/signup/forgot-password/join. Camada decorativa full-bleed
// posicionada absolutamente dentro de um parent `relative`; o
// card do formulário vive num `main` `relative z-10` acima dela.
//
// A composição tem três partes, todas em CSS:
//   1. base `.fire-wallpaper` — halos de chama estacionários
//      (radial-gradient com color-mix() + tokens --flame-*);
//   2. blobs de brasa — discos desfocados que derivam devagar
//      (reusam `animate-float-slow`, já neutralizado pelo
//      prefers-reduced-motion no globals.css);
//   3. fagulhas — pontinhos de brasa com brilho.
// A vignette (aprofundar as bordas) é um `::after` em CSS.
//
// Tudo aria-hidden + pointer-events-none: nada aqui interage
// com o usuário.
// ============================================================

import { cn } from '@/lib/utils';

const BLOBS = [
  {
    id: 'b0',
    className:
      'fire-wallpaper-blob--flame-2 left-[6%] -top-[10%] h-[24rem] w-[28rem]',
    delay: '0s',
  },
  {
    id: 'b1',
    className:
      'fire-wallpaper-blob--flame-1 right-[-10%] top-[26%] h-[22rem] w-[22rem]',
    delay: '1.6s',
  },
  {
    id: 'b2',
    className:
      'fire-wallpaper-blob--flame-3 -bottom-[12%] left-[-8%] h-[26rem] w-[26rem]',
    delay: '3.1s',
  },
];

const EMBERS = [
  { id: 'e0', left: '18%', top: '42%', size: 5, delay: '0.4s' },
  { id: 'e1', left: '72%', top: '20%', size: 4, delay: '1.1s' },
  { id: 'e2', left: '85%', top: '62%', size: 6, delay: '2.3s' },
  { id: 'e3', left: '38%', top: '84%', size: 4, delay: '0.9s' },
  { id: 'e4', left: '58%', top: '76%', size: 5, delay: '2.8s' },
  { id: 'e5', left: '10%', top: '12%', size: 5, delay: '3.6s' },
  { id: 'e6', left: '48%', top: '18%', size: 4, delay: '1.9s' },
  { id: 'e7', left: '92%', top: '84%', size: 5, delay: '3.2s' },
];

export function FireWallpaper() {
  return (
    <div
      aria-hidden
      className="fire-wallpaper pointer-events-none absolute inset-0 overflow-hidden"
    >
      {BLOBS.map((blob) => (
        <span
          key={blob.id}
          className={cn(
            'fire-wallpaper-blob animate-float-slow',
            blob.className
          )}
          style={{ animationDelay: blob.delay }}
        />
      ))}
      {EMBERS.map((ember) => (
        <span
          key={ember.id}
          className="fire-wallpaper-ember animate-float-slow opacity-50"
          style={{
            left: ember.left,
            top: ember.top,
            width: ember.size,
            height: ember.size,
            animationDelay: ember.delay,
          }}
        />
      ))}
    </div>
  );
}
