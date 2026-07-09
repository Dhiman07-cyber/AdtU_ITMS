/**
 * D2 Calendar — PostgreSQL Repository unit tests
 *
 * Tests pgFindActiveConfig() and pgSaveConfig() using a mocked
 * Supabase client so no live DB connection is required.
 *
 * Business invariants verified:
 *  • Lifecycle dates are derived correctly from the stored anchor
 *  • All DeadlineConfig fields are populated
 *  • Only anchor fields (not derived dates) are written to PG
 *  • Error propagation works
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase server ────────────────────────────────────────────────────
const mockMaybeSingle = vi.fn();
const mockUpsert      = vi.fn();

const mockDb = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
    upsert: mockUpsert,
  })),
};

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => mockDb,
}));

// ─── Import SUT after mocking ─────────────────────────────────────────────────
import { pgFindActiveConfig, pgSaveConfig } from '../repositories/calendar.repository.pg';

// ─── Fixture: minimal PG row that matches the schema ─────────────────────────
const PG_ROW_FIXTURE = {
  id:                        'test-uuid',
  is_active:                 true,
  session_start_month:       6,   // July (0-indexed)
  session_start_day:         1,
  urgent_warning_days:       15,
  soft_block_warning_text:   'Your bus service has expired. Please renew.',
  hard_delete_critical_text: 'Warning: Account will be permanently deleted.',
  contact_office_name:       'Transport Office',
  contact_phone:             '+91-1234567890',
  contact_email:             'transport@adtu.in',
  contact_office_hours:      'Mon–Fri 9–5',
  contact_address:           'ADTU Campus',
  contact_visit_instructions: 'Visit Room 101',
  landing_page:              null,
  application_process:       null,
  statistics:                null,
  config_version:            '1.0.0',
  description:               'Test config',
  updated_at:                '2026-07-01T00:00:00.000Z',
  updated_by:                'admin-uid',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('CalendarRepository.pg — pgFindActiveConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a fully populated DeadlineConfig from a PG row', async () => {
    mockMaybeSingle.mockResolvedValue({ data: PG_ROW_FIXTURE, error: null });

    const config = await pgFindActiveConfig();

    // Core anchor
    expect(config.academicSessionStart.month).toBe(6);
    expect(config.academicSessionStart.day).toBe(1);

    // Derived: expiry = 1 day before next July 1 (in REFERENCE_YEAR 2026)
    // → June 30, 2026 → month index 5
    expect(config.academicYear.anchorMonth).toBe(5);   // June
    expect(config.academicYear.anchorDay).toBe(30);

    // Derived: softBlock = July 1, 2026 → month index 6
    expect(config.softBlock.month).toBe(6);
    expect(config.softBlock.day).toBe(1);

    // Derived: hardDelete = July 1, 2028 → month index 6
    expect(config.hardDelete.month).toBe(6);
    expect(config.hardDelete.day).toBe(1);

    // Text fields
    expect(config.softBlock.warningText).toBe('Your bus service has expired. Please renew.');
    expect(config.hardDelete.criticalWarningText).toBe('Warning: Account will be permanently deleted.');
    expect(config.urgentWarningThreshold.days).toBe(15);

    // Contact
    expect(config.contactInfo.officeName).toBe('Transport Office');

    // Timeline events must always have exactly 4 milestones
    expect(config.timeline.events).toHaveLength(4);
    expect(config.timeline.events[3].critical).toBe(true);

    // Renewal notification: reminder1 = 3 months before expiry (June 30)
    // → 3 months before June → March 1 → month 2
    expect(config.renewalNotification.month).toBe(2); // March
    expect(config.renewalNotification.day).toBe(1);
  });

  it('throws when no active row exists in PG', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(pgFindActiveConfig()).rejects.toThrow(
      'Deadline configuration missing in database'
    );
  });

  it('throws when Supabase returns an error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    await expect(pgFindActiveConfig()).rejects.toThrow(
      'CalendarRepository (PG) read failed: connection refused'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CalendarRepository.pg — pgSaveConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts only anchor + mutable fields — NOT derived lifecycle dates', async () => {
    mockUpsert.mockResolvedValue({ error: null });

    const config: any = {
      academicSessionStart:    { month: 6, day: 1 },
      urgentWarningThreshold:  { days: 15 },
      softBlock:               { warningText: 'Renew now!' },
      hardDelete:              { criticalWarningText: 'Final warning' },
      contactInfo: {
        officeName: 'Admin', phone: '123', email: 'a@b.com',
        officeHours: '9-5', address: 'Bldg A', visitInstructions: 'Floor 2',
      },
      landingPage:        null,
      applicationProcess: null,
      statistics:         null,
      version:            '1.0.0',
      description:        'test',
      // Deliberately include derived fields that should NOT be stored:
      academicYear:           { anchorMonth: 5, anchorDay: 30 },
      renewalNotification:    { month: 2, day: 1 },
      renewalDeadline:        { month: 5, day: 30 },
      timeline:               { events: [] },
    };

    await pgSaveConfig(config, 'admin-uid');

    // Verify upsert was called
    expect(mockUpsert).toHaveBeenCalledOnce();

    const [payload] = mockUpsert.mock.calls[0];

    // Anchor fields present
    expect(payload.session_start_month).toBe(6);
    expect(payload.session_start_day).toBe(1);
    expect(payload.urgent_warning_days).toBe(15);
    expect(payload.soft_block_warning_text).toBe('Renew now!');
    expect(payload.hard_delete_critical_text).toBe('Final warning');
    expect(payload.updated_by).toBe('admin-uid');

    // Derived fields must NOT appear in the payload
    expect(payload).not.toHaveProperty('academicYear');
    expect(payload).not.toHaveProperty('renewalNotification');
    expect(payload).not.toHaveProperty('renewalDeadline');
    expect(payload).not.toHaveProperty('timeline');
  });

  it('throws when upsert fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'unique violation' } });

    await expect(
      pgSaveConfig({ academicSessionStart: { month: 6, day: 1 } } as any)
    ).rejects.toThrow('CalendarRepository (PG) write failed: unique violation');
  });
});
