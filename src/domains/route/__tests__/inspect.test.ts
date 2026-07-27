import 'dotenv/config';
import { describe, it } from 'vitest';
import { adminDb } from '@/lib/firebase-admin';

describe('Inspect Firestore Routes', () => {
  it('prints the routes', async () => {
    console.log('--- INSPECTING ROUTES ---');
    if (!adminDb) {
      console.error('Firebase admin not initialized');
      return;
    }
    const snapshot = await adminDb.collection('routes').limit(5).get();
    if (snapshot.empty) {
      console.log('No routes found.');
      return;
    }
    snapshot.forEach(doc => {
      console.log(`Document ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
      console.log('------------------------');
    });
  });
});
