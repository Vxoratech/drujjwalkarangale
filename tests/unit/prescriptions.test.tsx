import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureBranch, fixtureConsultation, fixtureOrganization, fixtureDoctor, fixturePatient, fixturePrescription } from '@/dev/fixtures';
import { PrescriptionDocument } from '@/features/prescriptions/PrescriptionDocument';
import { PrescriptionEditorPage } from '@/features/prescriptions/PrescriptionEditorPage';
import { I18nProvider } from '@/locales/i18n';
import { DOCTOR_PERMISSIONS, renderRoute } from './render';

vi.mock('@/features/auth/AuthProvider', () => ({ useCurrentUser: () => ({ id: '00000000-0000-4000-8000-000000000201', email: 'dr@example.test', user_metadata: {} }) }));
vi.mock('@/services/clinic', () => ({ fetchDoctors: vi.fn().mockResolvedValue([{ user_id: '00000000-0000-4000-8000-000000000201', full_name: 'Dr. Ujjwal Karangale' }]) }));
vi.mock('@/services/patients', () => ({ getPatient: vi.fn().mockResolvedValue(fixturePatient) }));
const api = vi.hoisted(() => ({
  savePrescriptionDraft: vi.fn(),
  issuePrescription: vi.fn(),
  getPrescription: vi.fn(),
  listPrescriptionRevisions: vi.fn().mockResolvedValue([]),
  listTemplates: vi.fn().mockResolvedValue([]),
  revisePrescription: vi.fn(),
  cancelPrescription: vi.fn(),
  saveTemplate: vi.fn(),
}));
vi.mock('@/services/clinical', () => api);

beforeEach(() => {
  vi.clearAllMocks();
  api.listPrescriptionRevisions.mockResolvedValue([]);
  api.listTemplates.mockResolvedValue([]);
});

describe('prescription creation and issue', () => {
  it('saves the draft, then issues only after the clinician confirms the review', async () => {
    api.savePrescriptionDraft.mockResolvedValue('rx-1');
    api.issuePrescription.mockResolvedValue({});
    renderRoute(<PrescriptionEditorPage />, { path: '/prescriptions/new', url: `/prescriptions/new?patient=${fixturePatient.id}`, permissions: DOCTOR_PERMISSIONS, account: 'primary_doctor' });

    // Wait for the one-time prefill (patient prefers Marathi) before typing.
    await waitFor(() => expect(screen.getByLabelText(/Print language/)).toHaveValue('mr'));
    await userEvent.type(screen.getByLabelText(/^Medicine/), 'Yogaraj Guggulu');
    await userEvent.type(screen.getByLabelText(/^Dose/), '2 tablets');
    await userEvent.type(screen.getByLabelText(/^Frequency/), 'Twice daily');
    await userEvent.type(screen.getByLabelText(/Instructions \(Marathi\)/), 'जेवणानंतर');
    await userEvent.click(screen.getByRole('button', { name: 'Issue prescription' }));

    const dialog = await screen.findByRole('dialog');
    const issue = within(dialog).getByRole('button', { name: 'Issue prescription' });
    expect(issue).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /I have reviewed every medicine/ }));
    await userEvent.click(issue);

    await waitFor(() => expect(api.issuePrescription).toHaveBeenCalledWith('rx-1', true));
    const [input, items] = api.savePrescriptionDraft.mock.calls[0]!;
    // The patient prefers Marathi, so the prescription defaults to Marathi; it is filed at the current branch.
    expect(input).toMatchObject({ patient_id: fixturePatient.id, header: { language: 'mr', branch_id: 'b-main' } });
    expect(items).toEqual([expect.objectContaining({ medicine_name: 'Yogaraj Guggulu', dose: '2 tablets', instructions_mr: 'जेवणानंतर', instructions_en: null })]);
  });

  it('does not save when required medicine fields are missing', async () => {
    renderRoute(<PrescriptionEditorPage />, { path: '/prescriptions/new', url: `/prescriptions/new?patient=${fixturePatient.id}`, permissions: DOCTOR_PERMISSIONS, account: 'primary_doctor' });
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect((await screen.findAllByText('This field is required.')).length).toBeGreaterThanOrEqual(3);
    expect(api.savePrescriptionDraft).not.toHaveBeenCalled();
  });

  it('an issued prescription is read-only and offers revision, which needs a reason', async () => {
    api.getPrescription.mockResolvedValue({ ...fixturePrescription('en', 2), revision_number: 1, revision_reason: null });
    api.revisePrescription.mockResolvedValue({});
    renderRoute(<PrescriptionEditorPage />, { path: '/prescriptions/:prescriptionId', url: '/prescriptions/rx-1', permissions: DOCTOR_PERMISSIONS, account: 'primary_doctor' });
    await screen.findByRole('button', { name: 'Revise' });
    for (const input of screen.getAllByLabelText(/^Medicine/)) expect(input).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Revise' }));
    const dialog = await screen.findByRole('dialog');
    const revise = within(dialog).getByRole('button', { name: 'Revise' });
    expect(revise).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason for revision/), 'Dose adjusted');
    await userEvent.click(revise);
    await waitFor(() => expect(api.revisePrescription).toHaveBeenCalledWith('rx-1', 'Dose adjusted'));
  });
});

describe('printed prescription', () => {
  const renderDoc = (language: 'en' | 'mr', uiLocale: 'en' | 'mr' = 'en') =>
    render(
      <I18nProvider defaultLocale={uiLocale}>
        <PrescriptionDocument organization={fixtureOrganization} branch={fixtureBranch} rx={fixturePrescription(language, 3)} patient={fixturePatient} doctor={fixtureDoctor} consultation={fixtureConsultation} />
      </I18nProvider>,
    );

  it('renders Marathi labels and the clinician’s Marathi instructions, regardless of UI language', () => {
    renderDoc('mr', 'en');
    expect(screen.getByRole('heading', { name: 'औषधपत्र' })).toBeInTheDocument();
    expect(screen.getAllByText(/जेवणानंतर कोमट पाण्यासोबत घ्या/)).toHaveLength(3);
    expect(screen.getByText(/आवृत्ती 2/)).toBeInTheDocument();
    expect(screen.getByText('पथ्य')).toBeInTheDocument();
  });

  it('renders English for an English prescription even in a Marathi UI', () => {
    renderDoc('en', 'mr');
    expect(screen.getByRole('heading', { name: 'Prescription' })).toBeInTheDocument();
    expect(screen.getAllByText(/Take with lukewarm water after meals/)).toHaveLength(3);
  });

  it('never prints internal notes, doctor notes or medicine names translated', () => {
    renderDoc('mr');
    expect(screen.queryByText(/must never print/)).not.toBeInTheDocument();
    expect(screen.getByText('Yogaraj Guggulu')).toBeInTheDocument();
    expect(screen.getByText('RX-2026-000014', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Dr. Ujjwal Karangale')).toBeInTheDocument();
  });
});
