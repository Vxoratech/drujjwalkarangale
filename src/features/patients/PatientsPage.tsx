import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { DataTable, type Column, type SortState } from '@/components/data-display/DataTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SearchInput, Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ageLabel, formatDate, fullName, maskPhone } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { listPatients, type PatientListItem, type PatientListParams } from '@/services/patients';
import { PATIENT_STATUSES, type PatientStatus } from '@/types/domain';
import { PatientFormDrawer } from './PatientFormDrawer';

const PAGE_SIZE = 20;

export function PatientsPage() {
  const { t } = useI18n();
  const { can, branches, branchName } = useAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'created_at', direction: 'desc' });
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [status, setStatus] = useState<PatientStatus | 'all'>('active');
  // Patients are central; this narrows to the registering branch only.
  const [branchFilter, setBranchFilter] = useState('');
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

  const listParams: PatientListParams = { search: debounced, page, pageSize: PAGE_SIZE, sort: sort as PatientListParams['sort'], status, branchId: branchFilter || undefined };
  const query = useQuery({ queryKey: qk.patients(listParams), queryFn: () => listPatients(listParams), placeholderData: keepPreviousData });

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
          {ageLabel(p)} · {t(`gender.${p.gender}`)}
        </span>
      ),
    },
    { key: 'phone', header: t('patients.phone'), cell: (p) => <span className="tabular text-ink-muted">{maskPhone(p.phone)}</span> },
    ...(branches.length > 1
      ? [{ key: 'branch', header: t('patients.registeredAt'), hideBelow: 'lg' as const, cell: (p: PatientListItem) => <span className="text-ink-muted">{branchName(p.registered_branch_id)}</span> }]
      : []),
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
          {branches.length > 1 && (
            <div className="sm:ml-auto sm:min-w-[11rem]">
              <Select
                aria-label={t('patients.registeredAt')}
                value={branchFilter}
                onChange={(e) => {
                  setBranchFilter(e.target.value);
                  setPage(1);
                }}
                placeholder={t('branches.allBranches')}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          )}
          <div className="sm:min-w-[10rem]">
            <Select
              aria-label={t('patients.statusFilter')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as PatientStatus | 'all');
                setPage(1);
              }}
              options={[{ value: 'all', label: t('common.all') }, ...PATIENT_STATUSES.map((s) => ({ value: s, label: t(`patientStatus.${s}`) }))]}
            />
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
                <PatientIdentity name={fullName(p)} code={p.patient_code} meta={`${ageLabel(p)} · ${t(`gender.${p.gender}`)}`} />
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
