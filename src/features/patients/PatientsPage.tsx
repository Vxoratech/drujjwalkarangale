import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { DataTable, type Column, type SortState } from '@/components/data-display/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SearchInput } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDoctors } from '@/hooks/useDoctors';
import { ageFromDob, formatDate, fullName, maskPhone } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listPatients, type PatientListItem, type PatientListParams } from '@/services/patients';
import { PatientFormDrawer } from './PatientFormDrawer';

const PAGE_SIZE = 20;

export function PatientsPage() {
  const { t } = useI18n();
  const { clinicId, can } = useClinic();
  const { names } = useDoctors();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'created_at', direction: 'desc' });
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const debounced = useDebouncedValue(search);

  useEffect(() => setPage(1), [debounced]);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    next.delete('new');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const listParams: PatientListParams = { search: debounced, page, pageSize: PAGE_SIZE, sort: sort as PatientListParams['sort'] };
  const query = useQuery({ queryKey: qk.patients(clinicId, listParams), queryFn: () => listPatients(clinicId, listParams), placeholderData: keepPreviousData });

  const columns: Column<PatientListItem>[] = [
    {
      key: 'name',
      header: t('patients.name'),
      sortable: true,
      cell: (p) => (
        <Link to={`/patients/${p.id}`} className="block rounded" onClick={(e) => e.stopPropagation()}>
          <PatientIdentity name={fullName(p)} code={p.patient_code} />
        </Link>
      ),
    },
    {
      key: 'age',
      header: `${t('patients.age')} / ${t('patients.gender')}`,
      hideBelow: 'lg',
      cell: (p) => (
        <span className="tabular text-ink-muted">
          {ageFromDob(p.date_of_birth) ?? '—'} · {t(`gender.${p.gender}`)}
        </span>
      ),
    },
    { key: 'phone', header: t('patients.phone'), cell: (p) => <span className="tabular text-ink-muted">{maskPhone(p.phone)}</span> },
    { key: 'prakriti', header: t('patients.prakriti'), hideBelow: 'lg', cell: (p) => (p.prakriti ? <Badge tone="forest">{t(`prakriti.${p.prakriti}`)}</Badge> : <span className="text-ink-subtle">—</span>) },
    { key: 'doctor', header: t('patients.assignedDoctor'), hideBelow: 'lg', cell: (p) => <span className="text-ink-muted">{p.assigned_doctor_id ? names.get(p.assigned_doctor_id) ?? '—' : t('patients.unassigned')}</span> },
    { key: 'created_at', header: t('patients.registered'), sortable: true, align: 'right', cell: (p) => <span className="tabular text-ink-muted">{formatDate(p.created_at)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t('patients.title')}
        description={t('patients.subtitle')}
        actions={
          can('patients.create') && (
            <Button leftIcon={<UserPlus className="size-4" />} onClick={() => setFormOpen(true)}>
              {t('patients.add')}
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <div className="w-full sm:max-w-sm">
            <SearchInput value={search} onValueChange={setSearch} placeholder={t('patients.searchPlaceholder')} aria-label={t('patients.searchPlaceholder')} clearLabel={t('common.clearFilters')} />
          </div>
        </Toolbar>
        {query.isLoading ? (
          <SkeletonRows rows={8} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption={t('patients.title')}
            columns={columns}
            rows={query.data!.rows}
            rowKey={(p) => p.id}
            sort={sort}
            onSortChange={(s) => {
              setSort(s);
              setPage(1);
            }}
            onRowClick={(p) => navigate(`/patients/${p.id}`)}
            mobileCard={(p) => (
              <div className="flex items-center justify-between gap-3">
                <PatientIdentity name={fullName(p)} code={p.patient_code} meta={`${ageFromDob(p.date_of_birth) ?? '—'} · ${t(`gender.${p.gender}`)}`} />
                <span className="tabular text-xs text-ink-muted">{maskPhone(p.phone)}</span>
              </div>
            )}
            pagination={{ page, pageSize: PAGE_SIZE, total: query.data!.total, onPageChange: setPage }}
            empty={
              debounced ? (
                <EmptyState icon={<UsersRound />} title={t('patients.noResults')} />
              ) : (
                <EmptyState
                  icon={<UsersRound />}
                  title={t('patients.emptyTitle')}
                  body={t('patients.emptyBody')}
                  action={can('patients.create') && <Button onClick={() => setFormOpen(true)}>{t('patients.add')}</Button>}
                />
              )
            }
          />
        )}
      </Card>
      <PatientFormDrawer open={formOpen} onOpenChange={setFormOpen} onSaved={(p) => navigate(`/patients/${p.id}`)} />
    </>
  );
}
