/**
 * Development-only design-system gallery (route /__gallery, DEV builds only).
 * Renders components with static props — it does not talk to the backend.
 */
import { CalendarDays, FilePen, IndianRupee, Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { ColumnChart } from '@/components/data-display/ColumnChart';
import { DataTable, type SortState } from '@/components/data-display/DataTable';
import { Timeline } from '@/components/data-display/Timeline';
import { Alert, EmptyState, ErrorState, PermissionDenied, SkeletonRows } from '@/components/feedback/States';
import { FileUpload } from '@/components/forms/FileUpload';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { BrandLockup } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox, DateInput, Input, RadioGroup, SearchInput, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { formatINR } from '@/lib/formatters';

const rows = [
  { id: '1', name: 'Sunita Pawar', code: 'P-000001', prakriti: 'Vata–Pitta', amount: 196160 },
  { id: '2', name: 'Ganesh More', code: 'P-000002', prakriti: 'Kapha', amount: 45000 },
  { id: '3', name: 'Ananya Kulkarni', code: 'P-000003', prakriti: 'Pitta', amount: 0 },
];

export function Gallery() {
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [agni, setAgni] = useState<'sama' | 'vishama' | 'tikshna' | 'manda'>('vishama');
  const [seg, setSeg] = useState<'d' | 'w' | 'm'>('w');
  const [search, setSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="page-x mx-auto max-w-content space-y-8 py-8">
      <BrandLockup />
      <PageHeader
        breadcrumbs={[{ label: 'Design system', to: '/__gallery' }, { label: 'Components' }]}
        title="Component gallery"
        description="Vaidyora tokens and components (development only)."
        actions={
          <>
            <Button variant="secondary">Secondary</Button>
            <Button leftIcon={<Plus className="size-4" />}>Primary action</Button>
          </>
        }
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's appointments" value="12" hint="4 remaining" icon={<CalendarDays />} />
        <StatCard label="Active patients" value="1,284" hint="36 new this month" icon={<UsersRound />} />
        <StatCard label="Collected this month" value={formatINR(48236000, { whole: true })} icon={<IndianRupee />} accent="gold" />
        <StatCard label="Draft consultations" value="3" icon={<FilePen />} accent="warning" />
      </section>
      <Card>
        <CardHeader title="ColumnChart" />
        <CardBody className="grid gap-8 md:grid-cols-2">
          <ColumnChart
            title="New patients"
            data={[3, 5, 2, 8, 6, 4, 9, 7, 5, 6, 11, 4, 3, 6].map((v, i) => ({ key: String(i), label: `${String(i + 12).padStart(2, '0')}/10`, value: v }))}
          />
          <ColumnChart
            title="Collected"
            data={[1250000, 860000, 0, 1940000, 1520000, 730000, 2100000].map((v, i) => ({ key: String(i), label: `${String(i + 19).padStart(2, '0')}/10`, value: v }))}
            formatValue={(v) => formatINR(v, { whole: true })}
            formatTick={(v) => `₹${Math.round(v / 100000)}K`}
          />
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        {['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'draft', 'finalized', 'partially_paid'].map((s) => (
          <StatusBadge key={s} status={s} label={s.replace(/_/g, ' ')} />
        ))}
        <Badge tone="gold">Prakriti: Vata–Pitta</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Saving</Button>
        <Button onClick={() => setConfirm(true)} variant="secondary">
          Open confirm dialog
        </Button>
      </div>
      <Card>
        <CardHeader title="Patients" description="DataTable with sorting, pagination and mobile cards" actions={<SearchInput value={search} onValueChange={setSearch} placeholder="Search" aria-label="Search" />} />
        <DataTable
          caption="Patients"
          rows={rows}
          rowKey={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          columns={[
            { key: 'name', header: 'Name', sortable: true, cell: (r) => <PatientIdentity name={r.name} code={r.code} /> },
            { key: 'prakriti', header: 'Prakriti', cell: (r) => <Badge tone="forest">{r.prakriti}</Badge> },
            { key: 'amount', header: 'Billed', align: 'right', sortable: true, cell: (r) => <span className="tabular">{formatINR(r.amount)}</span> },
          ]}
          mobileCard={(r) => <PatientIdentity name={r.name} code={r.code} meta={r.prakriti} />}
          pagination={{ page: 1, pageSize: 20, total: 3, onPageChange: () => undefined }}
        />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Form controls" />
          <CardBody className="space-y-4">
            <FormGrid>
              <FormField label="First name" required>
                <Input defaultValue="Sunita" />
              </FormField>
              <FormField label="Mobile number" error="Enter a valid phone number.">
                <Input defaultValue="98220" />
              </FormField>
              <FormField label="Date of birth" hint="DD/MM/YYYY">
                <DateInput defaultValue="1978-04-12" />
              </FormField>
              <FormField label="Prakriti">
                <Select options={[{ value: 'vp', label: 'Vata–Pitta' }]} />
              </FormField>
            </FormGrid>
            <FormField label="Chief complaint">
              <Textarea defaultValue="Bilateral knee pain, worse in the morning, for 3 months" />
            </FormField>
            <RadioGroup name="agni" legend="Agni" value={agni} onChange={setAgni} options={(['sama', 'vishama', 'tikshna', 'manda'] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} />
            <Checkbox label="I also practise as a doctor in this clinic" defaultChecked />
            <SegmentedControl label="Range" value={seg} onChange={setSeg} options={[{ value: 'd', label: 'Day' }, { value: 'w', label: 'Week' }, { value: 'm', label: 'Month' }]} />
            <FileUpload label="Report file" value={file} onChange={setFile} hint="PDF, PNG, JPG · max 10 MB" />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Tabs & timeline" />
            <CardBody>
              <Tabs defaultValue="a">
                <TabsList label="Example">
                  <TabsTrigger value="a" count={3}>Visits</TabsTrigger>
                  <TabsTrigger value="b">Prescriptions</TabsTrigger>
                </TabsList>
                <TabsContent value="a">
                  <Timeline
                    label="Visits"
                    items={[
                      { id: '1', title: 'Consultation finalized', time: '22/10/2026, 10:24 AM', body: 'Sandhigata Vata', icon: <FilePen /> },
                      { id: '2', title: 'Prescription issued', time: '22/10/2026, 10:31 AM', body: 'RX-2026-000014', tone: 'gold', icon: <FilePen /> },
                    ]}
                  />
                </TabsContent>
                <TabsContent value="b">—</TabsContent>
              </Tabs>
            </CardBody>
          </Card>
          <Alert tone="danger" title="Allergies">Sulpha drugs</Alert>
          <Alert tone="info">This consultation is finalized and read-only.</Alert>
          <Card><SkeletonRows rows={3} /></Card>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><EmptyState compact title="No patients yet" body="Register your first patient to start recording consultations." action={<Button>Register patient</Button>} /></Card>
        <Card><ErrorState compact onRetry={() => undefined} /></Card>
        <Card><PermissionDenied compact /></Card>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Finalize this consultation?" body="Finalized records are locked and cannot be edited." confirmLabel="Finalize consultation" onConfirm={() => undefined} />
    </div>
  );
}
