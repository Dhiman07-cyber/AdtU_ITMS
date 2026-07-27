import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { submitFinal } from '@/domains/application';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const uid = auth.uid;
      const email = auth.email;
      const rawFormData = { ...asRecord((body as any).formData) };
      if ('age' in rawFormData) {
        delete rawFormData.age;
      }

      if (Object.keys(rawFormData).length === 0) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const result = await submitFinal(uid, email || '', rawFormData, asRecord(body));

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        applicationId: result.applicationId,
        message: 'Application submitted successfully and waiting for approval',
      });
    } catch (error) {
      console.error('Failed to submit application:', error);
      return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
    }
  },
  {
    requiredRoles: [],
    schema: undefined,
  }
);
