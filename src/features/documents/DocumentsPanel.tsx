import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FileUpload } from '@/components/forms/FileUpload';
import { FormField } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDate } from '@/lib/formatters';
import { useI18n } from '@/locales/i18n';
import { deleteDocument, getDocumentUrl, listDocuments, uploadDocument } from '@/services/documents';
import { DOCUMENT_CATEGORIES, type DocumentCategory, type PatientDocument, type UUID } from '@/types/domain';

export function UploadDocumentDialog({
  open,
  onOpenChange,
  patientId,
  investigationId,
  consultationId,
  defaultCategory = 'other',
  defaultTitle = '',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: UUID;
  investigationId?: UUID | null;
  consultationId?: UUID | null;
  defaultCategory?: DocumentCategory;
  defaultTitle?: string;
}) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);

  const mutation = useMutation({
    mutationFn: () => uploadDocument(clinicId, { patientId, file: file!, title: title.trim() || file!.name, category, investigationId, consultationId }),
    onSuccess: async () => {
      notify.success(t('documents.uploaded'));
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'documents'] });
      setFile(null);
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={t('documents.upload')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button leftIcon={<Upload className="size-4" />} loading={mutation.isPending} disabled={!file} onClick={() => mutation.mutate()}>
            {t('common.upload')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label={t('documents.docTitle')}>
          <Input maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField label={t('documents.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`documentCategory.${c}`) }))} />
        </FormField>
        <FileUpload label={t('documents.file')} value={file} onChange={setFile} />
      </div>
    </Modal>
  );
}

export function useOpenDocument() {
  return async (doc: Pick<PatientDocument, 'id'>) => {
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed URL.
    const win = window.open('', '_blank', 'noopener');
    try {
      const url = await getDocumentUrl(doc.id);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      win?.close();
      notify.error(e);
    }
  };
}

export function DocumentsPanel({ patientId, canWrite }: { patientId: UUID; canWrite: boolean }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const openDocument = useOpenDocument();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<PatientDocument | null>(null);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: [clinicId, 'documents', patientId], queryFn: () => listDocuments(clinicId, { patientId }) });

  const remove = useMutation({
    mutationFn: () => deleteDocument(removing!.id, reason),
    onSuccess: async () => {
      notify.success(t('documents.removed'));
      setReason('');
      await queryClient.invalidateQueries({ queryKey: [clinicId, 'documents'] });
    },
    onError: (e) => notify.error(e),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">{t('documents.accessLogged')}</p>
        {canWrite && (
          <Button variant="secondary" leftIcon={<Upload className="size-4" />} onClick={() => setUploading(true)}>
            {t('documents.upload')}
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <SkeletonRows rows={3} />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} />
      ) : query.data!.length === 0 ? (
        <EmptyState compact icon={<FileText />} title={t('documents.empty')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {query.data!.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="size-5 shrink-0 text-forest" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="tabular text-xs text-ink-muted">
                    {formatDate(d.created_at)} · {(d.size_bytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <Badge>{t(`documentCategory.${d.category}`)}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" leftIcon={<ExternalLink className="size-4" />} onClick={() => void openDocument(d)}>
                  {t('common.download')}
                </Button>
                {canWrite && <IconButton size="sm" label={`${t('documents.remove')}: ${d.title}`} icon={<Trash2 />} onClick={() => setRemoving(d)} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && <UploadDocumentDialog open={uploading} onOpenChange={setUploading} patientId={patientId} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            setReason('');
          }
        }}
        title={t('documents.remove')}
        body={t('documents.removeBody')}
        confirmLabel={t('documents.remove')}
        cancelLabel={t('common.back')}
        tone="danger"
        confirmDisabled={!reason.trim()}
        onConfirm={() => remove.mutateAsync()}
      >
        <FormField label={t('documents.removeReason')} required>
          <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
