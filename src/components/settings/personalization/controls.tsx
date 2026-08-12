'use client';

import { useRef } from 'react';
import { Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Reusable form controls for the Personalização panel. Kept in this
 * folder because they're only used there — color swatches + a native
 * range slider (no slider component exists in the UI kit) + a hidden
 * file input wrapper for brand asset uploads.
 */

export function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="border-border relative block h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border">
        <span className="sr-only">{label}</span>
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ background: value }}
        />
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-xs font-medium">
          {label}
        </span>
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary mt-0.5 h-7 w-full rounded-md border px-2 font-mono text-xs outline-none focus:ring-1 disabled:opacity-60"
          spellCheck={false}
        />
      </span>
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (n: number) => string;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-foreground text-xs font-medium">{label}</label>
        <span className="text-muted-foreground font-mono text-xs">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-muted accent-primary h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}

export function ImagePickerButton({
  accept,
  disabled,
  busyLabel,
  busy,
  onFile,
  children,
}: {
  accept?: string;
  disabled?: boolean;
  busyLabel?: string;
  busy?: boolean;
  onFile: (file: File) => void;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? 'image/png,image/jpeg,image/webp'}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          (busyLabel ?? 'Enviando...')
        ) : (
          <>
            <Upload className="size-4" />
            {children}
          </>
        )}
      </Button>
    </>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-muted inline-flex items-center gap-1 rounded-lg p-1',
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            o.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
