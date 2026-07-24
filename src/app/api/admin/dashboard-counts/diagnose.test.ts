import 'dotenv/config';
import { describe, it } from 'vitest';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import path from 'path';


describe('Diagnose Dashboard Counts API Queries', () => {
  it('should run all queries individually and log status', async () => {
    console.log('Starting diagnosis...');
    console.log('Firebase Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    if (!adminDb) {
      console.error('❌ Firebase Admin DB is null/not initialized!');
    } else {
      console.log('✅ Firebase Admin DB is initialized');
    }

    let supabase;
    try {
      supabase = getSupabaseServer();
      console.log('✅ Supabase Server Client is initialized');
    } catch (err: any) {
      console.error('❌ Supabase Server Client initialization failed:', err.message);
    }

    const runQuery = async (name: string, fn: () => Promise<any>) => {
      try {
        const start = Date.now();
        const res = await fn();
        console.log(`✅ [${name}] Succeeded in ${Date.now() - start}ms. Result/Size:`, 
          res && typeof res.size === 'number' ? `${res.size} docs` : 
          res && typeof res.data === 'function' ? `count = ${res.data().count}` : 
          res && res.data ? `supabase rows = ${res.data.length}` : 
          res && typeof res.exists === 'boolean' ? `exists = ${res.exists}` : 
          'done'
        );
        if (res && res.error) {
          console.error(`   ⚠️ Supabase query returned error:`, res.error);
        }
      } catch (err: any) {
        console.error(`❌ [${name}] Failed:`, err.message);
        if (err.stack) {
          console.error(err.stack);
        }
      }
    };

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. Firebase Counts
    if (adminDb) {
      await runQuery("students.count()", () => adminDb.collection('students').count().get());
      await runQuery("students.where('status', '==', 'active').count()", () => adminDb.collection('students').where('status', '==', 'active').count().get());
      await runQuery("students.where('status', '==', 'active').where('shift', '==', 'Morning').count()", () => adminDb.collection('students').where('status', '==', 'active').where('shift', '==', 'Morning').count().get());
      await runQuery("students.where('status', '==', 'active').where('shift', '==', 'Evening').count()", () => adminDb.collection('students').where('status', '==', 'active').where('shift', '==', 'Evening').count().get());
      await runQuery("students.where('status', '==', 'expired').count()", () => adminDb.collection('students').where('status', '==', 'expired').count().get());
      await runQuery("drivers.count()", () => adminDb.collection('drivers').count().get());
      await runQuery("buses.get()", () => adminDb.collection('buses').get());
      await runQuery("routes.get()", () => adminDb.collection('routes').get());
      await runQuery("applications.where('state', '==', 'submitted').count()", () => adminDb.collection('applications').where('state', '==', 'submitted').count().get());
      await runQuery("applications.where('state', '==', 'awaiting_verification').count()", () => adminDb.collection('applications').where('state', '==', 'awaiting_verification').count().get());
      await runQuery("supabase.applications (renewal pending count)", () => supabase!.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted').in('application_type', ['renewal', 'renewal_after_soft_block']));
      await runQuery("feedbacks.where('createdAt', '>=', sevenDaysAgo).count()", () => adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get());
      await runQuery("settings.doc('config').get()", () => adminDb.collection('settings').doc('config').get());
    }

    // 2. Supabase
    if (supabase) {
      await runQuery("supabase.active_trips", () => supabase.from('active_trips').select('*').eq('status', 'active'));
      await runQuery("supabase.payments", () => supabase.from('payments').select('amount, method').or('status.eq.Completed,status.eq.completed'));
    }
  });
});
