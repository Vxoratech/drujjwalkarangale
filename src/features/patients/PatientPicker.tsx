import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { controlClasses } from '@/components/ui/Input';
import { useFieldControl } from '@/components/forms/FormField';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { fullName, maskPhone } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { getPatient, searchPatients, type PatientListItem } from '@/services/patients';
import type { UUID } from '@/types/domain';

export interface PatientPickerProps {
  value: UUID | null;
  onChange: (id: UUID | null) => void;
  disabled?: boolean;
}

/** Accessible combobox (WAI-ARIA 1.2 pattern) for selecting a patient by name, phone or ID. */
export function PatientPicker({ value, onChange, disabled }: PatientPickerProps) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const field = useFieldControl();
  const listId = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(term, 250);

  const selected = useQuery({ queryKey: qk.patient(clinicId, value ?? ''), queryFn: () => getPatient(clinicId, value!), enabled: Boolean(value) });
  const results = useQuery({
    queryKey: qk.patients(clinicId, { picker: debounced }),
    queryFn: () => searchPatients(clinicId, debounced),
    enabled: open && debounced.trim().length >= 2,
  });
  const options: PatientListItem[] = results.data ?? [];

  function choose(p: PatientListItem) {
    onChange(p.id);
    setTerm('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (value && selected.data) {
    return (
      <div className={cn(controlClasses, 'flex min-h-10 items-center justify-between gap-2 px-3 py-1.5')}>
        <PatientIdentity name={fullName(selected.data)} code={selected.data.patient_code} meta={maskPhone(selected.data.phone)} />
        {!disabled && (
          <button type="button" className="rounded p-1 hover:bg-sage" onClick={() => onChange(null)} aria-label={t('common.remove')}>
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  const showList = open && debounced.trim().length >= 2;

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      <input
        {...field}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${listId}-${options[active].id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={term}
        placeholder={t('appointments.selectPatient')}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className={cn(controlClasses, 'h-10 pl-9 pr-3')}
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute z-dropdown mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-md">
          {results.isLoading && <li className="px-3 py-2 text-sm text-ink-muted">{t('common.loading')}</li>}
          {!results.isLoading && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{t('patients.noResults')}</li>}
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer rounded px-2 py-1.5', i === active && 'bg-sage')}
            >
              <PatientIdentity name={fullName(p)} code={p.patient_code} meta={maskPhone(p.phone)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
