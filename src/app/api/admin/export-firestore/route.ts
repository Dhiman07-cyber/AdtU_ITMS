import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';

const COLLECTIONS_TO_EXPORT = [
    'users', 'students', 'drivers', 'buses', 'routes', 'moderators',
    'applications', 'notifications', 'payments', 'config', 'admins'
];

function convertTimestamps(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (obj.toDate && typeof obj.toDate === 'function') {
        return { _type: 'timestamp', value: obj.toDate().toISOString() };
    }
    if (obj._seconds !== undefined && obj._nanoseconds !== undefined) {
        return { _type: 'timestamp', value: new Date(obj._seconds * 1000).toISOString() };
    }
    if (Array.isArray(obj)) return obj.map(item => convertTimestamps(item));
    if (typeof obj === 'object') {
        const converted: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                converted[key] = convertTimestamps(obj[key]);
            }
        }
        return converted;
    }
    return obj;
}

export const GET = withSecurity(
    async (request, { auth }) => {
        console.log(`📦 Firestore export requested by admin: ${auth.uid.substring(0,8)}...`);

        const exportData: any = {
            metadata: {
                exportedAt: new Date().toISOString(),
                exportedBy: auth.email,
                firebase: { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID },
                version: '1.0.0'
            },
            collections: {}
        };

        let totalDocuments = 0;
        for (const collectionName of COLLECTIONS_TO_EXPORT) {
            try {
                const snapshot = await adminDb.collection(collectionName).get();
                const documents: any = {};
                snapshot.forEach(doc => {
                    documents[doc.id] = convertTimestamps(doc.data());
                });

                exportData.collections[collectionName] = { documents, count: snapshot.size };
                totalDocuments += snapshot.size;
            } catch (error: any) {
                console.error(`   ❌ Error exporting ${collectionName}:`, error.message);
                exportData.collections[collectionName] = { documents: {}, count: 0, error: 'Export failed' };
            }
        }

        console.log(`📊 Total documents exported: ${totalDocuments}`);
        const jsonString = JSON.stringify(exportData, null, 2);

        return new NextResponse(jsonString, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="firestore_data_${new Date().toISOString().split('T')[0]}.json"`,
            },
        });
    },
    {
        requiredRoles: ['admin'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);
