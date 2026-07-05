import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { AUDIT_LOGS_COLLECTION } from '@/lib/services/audit.service';
import { Timestamp } from 'firebase-admin/firestore';

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || '';
    const severity = searchParams.get('severity') || '';
    const performedBy = searchParams.get('performedBy') || '';
    const performedByRole = searchParams.get('performedByRole') || '';
    const targetType = searchParams.get('targetType') || '';
    const search = searchParams.get('search') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || String(PAGE_SIZE), 10), 50);

    let query: FirebaseFirestore.Query = adminDb
      .collection(AUDIT_LOGS_COLLECTION)
      .orderBy('createdAt', 'desc');

    if (category) {
      query = query.where('category', '==', category);
    }
    if (severity) {
      query = query.where('severity', '==', severity);
    }
    if (performedByRole) {
      query = query.where('performedByRole', '==', performedByRole);
    }

    if (startDate) {
      const startTs = Timestamp.fromDate(new Date(startDate));
      query = query.where('createdAt', '>=', startTs);
    }
    if (endDate) {
      const endTs = Timestamp.fromDate(new Date(endDate + 'T23:59:59.999Z'));
      query = query.where('createdAt', '<=', endTs);
    }

    const offset = (page - 1) * limit;

    if (offset > 0) {
      const anchorSnap = await adminDb
        .collection(AUDIT_LOGS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(offset)
        .get();
      const lastDoc = anchorSnap.docs[anchorSnap.docs.length - 1];
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
    }

    query = query.limit(limit + 1);
    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limit;
    const docs = snapshot.docs.slice(0, limit);

    let results = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        auditId: data.auditId || doc.id,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAtISO || '',
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || '',
        category: data.category || '',
        action: data.action || '',
        summary: data.summary || '',
        description: data.description || '',
        severity: data.severity || 'low',
        performedBy: data.performedBy || '',
        performedByName: data.performedByName || '',
        performedByRole: data.performedByRole || '',
        performedAt: data.performedAt?.toDate?.()?.toISOString() || '',
        targetType: data.targetType || '',
        targetId: data.targetId || '',
        targetName: data.targetName || '',
        metadata: data.metadata || {},
        ipAddress: data.ipAddress || '',
        userAgent: data.userAgent || '',
      };
    });

    if (performedBy) {
      const lowerSearch = performedBy.toLowerCase();
      results = results.filter(
        (r) =>
          r.performedBy.toLowerCase().includes(lowerSearch) ||
          r.performedByName.toLowerCase().includes(lowerSearch)
      );
    }

    if (targetType) {
      results = results.filter((r) => r.targetType === targetType);
    }

    if (search) {
      const lowerSearch = search.toLowerCase();
      results = results.filter(
        (r) =>
          r.action.toLowerCase().includes(lowerSearch) ||
          r.summary.toLowerCase().includes(lowerSearch) ||
          r.description.toLowerCase().includes(lowerSearch) ||
          r.targetName.toLowerCase().includes(lowerSearch) ||
          r.performedByName.toLowerCase().includes(lowerSearch)
      );
    }

    return NextResponse.json({
      logs: results,
      page,
      hasMore,
      pageSize: limit,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { message: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
