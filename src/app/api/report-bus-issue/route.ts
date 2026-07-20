import { NextResponse } from 'next/server';
import { adminAuth, adminDb, messaging } from '@/lib/firebase-admin';
import { getDriverById, getUsersByRole, getValidFcmTokensForUsers } from '@/domains/identity';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { idToken, issueData } = body;

    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: 'Firebase Admin not initialized' }, { status: 500 });
    }

    // Verify Firebase ID token
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const driverUid = decodedToken.uid;

    // Verify that the driver exists in PostgreSQL (canonical source of truth)
    const driverData = await getDriverById(driverUid);
    if (!driverData) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    // Add driver information to issue data
    const issueWithDriver = {
      ...issueData,
      driverUid,
      driverName: driverData.fullName || driverData.name || "Unknown Driver",
      status: 'reported',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save issue to Firestore (retained operational collection)
    const issueRef = await adminDb.collection('bus_issues').add(issueWithDriver);

    // Send FCM notification to moderators
    try {
      // Get all moderators from PostgreSQL (canonical source of truth)
      const moderators = await getUsersByRole('moderator');
      const moderatorIds = moderators.map((m) => m.uid);

      if (moderatorIds.length > 0) {
        // Fetch tokens from PostgreSQL
        const tokenRecords = await getValidFcmTokensForUsers(moderatorIds);
        const moderatorTokens = tokenRecords.map(t => t.token);

        // Send FCM notification
        if (moderatorTokens.length > 0) {
          const message = {
            notification: {
              title: 'Bus Issue Reported',
              body: `Driver ${issueWithDriver.driverName} reported an issue with bus ${issueData.busId}: ${issueData.title}`
            },
            tokens: moderatorTokens
          };

          await messaging.sendEachForMulticast(message);
        }
      }
    } catch (fcmError) {
      console.error('Error sending FCM notifications to moderators:', fcmError);
    }

    return NextResponse.json({
      success: true,
      message: 'Bus issue reported successfully',
      issueId: issueRef.id
    });
  } catch (error: any) {
    console.error('Error reporting bus issue:', error);
    return NextResponse.json({ error: 'Failed to report bus issue' }, { status: 500 });
  }
}