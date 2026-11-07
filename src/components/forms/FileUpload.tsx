import { FileUp, Paperclip, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/i18n';

export interface FileUploadProps {
  label: string;
  accept?: string;
  /** Maximum size in bytes (default 10 MB, matching the storage bucket). */
  maxBytes?: number;
  value: File | null;
  onChange: (file: File | null) => void;
  hint?: string;
  disabled?: boolean;
}

const DEFAULT_MAX = 10 * 1024 * 1024;

export function FileUpload({ label, accept = 'application/pdf,image/png,image/jpeg,image/webp', maxBytes = DEFAULT_MAX, value, onChange, hint, disabled }: FileUploadProps) {
  const { t } = useI18n();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function accept_(file: File | undefined) {
    setError(null);
    if (!file) return;
    const allowed = accept.split(',').map((s) => s.trim());
    if (!allowed.includes(file.type)) {
      setError(t('upload.unsupportedType'));
      return;
    }
    if (file.size > maxBytes) {
      setError(t('upload.tooLarge', { mb: Math.round(maxBytes / 1024 / 1024) }));
      return;
    }
    onChange(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) accept_(e.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-ink" id={`${id}-label`}>
        {label}
      </span>
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-ivory px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="truncate">{value.name}</span>
            <span className="tabular shrink-0 text-xs text-ink-muted">{(value.size / 1024).toFixed(0)} KB</span>
          </span>
          <button type="button" className="rounded p-1 hover:bg-sage" onClick={() => onChange(null)} aria-label={t('upload.remove', { name: value.name })} disabled={disabled}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm transition-colors duration-fast',
            'has-[:focus-visible]:shadow-focus',
            dragging ? 'border-forest bg-sage' : 'border-line-strong bg-surface hover:bg-ivory',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <FileUp className="size-5 text-forest" aria-hidden />
          <span className="font-medium text-forest-deep">{t('upload.choose')}</span>
          <span className="text-xs text-ink-muted">{hint ?? t('documents.fileHint')}</span>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={accept}
            className="sr-only"
            disabled={disabled}
            aria-labelledby={`${id}-label`}
            onChange={(e) => {
              accept_(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
