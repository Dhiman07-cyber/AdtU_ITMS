
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import {
  readFeedback,
  addFeedback, // Changed from writeFeedback
  cleanupOldFeedback,
  generateFeedbackId,
  generateAutoDeleteTimestamp,
  validateMessage,
  sanitizeMessage,
  checkDuplicate,
  checkRateLimit,
  updateRateLimit,
  FeedbackEntry
} from '@/lib/feedback-utils';

/**
 * POST /api/feedback
 * Submit feedback (student & driver only)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message } = body;

    // Get token from Authorization header or body
    let token = body.idToken;
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;

    const { db } = await import('@/lib/firebase-admin');
    const { getByUid } = await import('@/domains/student');
    let userData: any = null;
    let userRole: string = '';

    // First check users collection for role
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userDocData = userDoc.data();
      userRole = userDocData?.role || '';

      // If user has student role, get data from PostgreSQL
      if (userRole === 'student') {
        userData = await getByUid(userId) as Record<string, any> | null;
      } else if (userRole === 'driver') {
        const driverDoc = await db.collection('drivers').doc(userId).get();
        if (driverDoc.exists) {
          userData = driverDoc.data();
        }
      }
    }

    // Reject if user is not student or driver
    if (!userData || (userRole !== 'student' && userRole !== 'driver')) {
      return NextResponse.json(
        { error: 'Only students and drivers can submit feedback' },
        { status: 403 }
      );
    }

    // Validate message
    const validation = validateMessage(message);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Check rate limit
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `You can send feedback again in ${rateLimit.minutesLeft} minutes.` },
        { status: 429 }
      );
    }

    // Check for duplicate (async check against Firestore)
    const sanitized = sanitizeMessage(message);
    const publicId = userData.enrollmentId || userData.driverId || userData.employeeId || 'N/A';

    // Note: checking duplicate using the public ID is fine because it's unique per user anyway
    // (We changed checkDuplicate to use the publicId instead of auth userId)
    const isDuplicate = await checkDuplicate(publicId, sanitized);
    if (isDuplicate) {
      return NextResponse.json(
        { error: 'You have already submitted this feedback recently' },
        { status: 400 }
      );
    }

    // Get bus info if available
    let bus_id = userData.assignedBusId || userData.busId || null;
    let bus_plate = null;

    if (bus_id) {
      try {
        const busDoc = await db.collection('buses').doc(bus_id).get();
        if (busDoc.exists) {
          bus_plate = busDoc.data()?.plateNumber || null;
        }
      } catch (e) {
        console.error('Error fetching bus info for feedback:', e);
      }
    }

    // Create new feedback entry
    const newEntry: FeedbackEntry = {
      id: generateFeedbackId(),
      user_id: publicId, // Key change: store enrollmentId or driverId here
      name: userData.fullName || userData.name || 'Unknown',
      email: userData.email || decodedToken.email || 'N/A',
      role: userRole as 'student' | 'driver',
      message: sanitized,
      created_at: new Date().toISOString(),
      read: false,
      auto_delete_at: generateAutoDeleteTimestamp(),
      profile_url: userData.profilePhotoUrl || userData.profile_url || null,
      bus_id: bus_id,
      bus_plate: bus_plate
    };

    // Add to Firestore
    await addFeedback(newEntry);

    // Update rate limit (using Auth UID is safer for strict rate limiting to prevent ID spoofing)
    updateRateLimit(decodedToken.uid);

    // Log action
    console.log('✅ Feedback submitted:', {
      id: newEntry.id,
      user_id: publicId,
      role: userRole
    });

    return NextResponse.json(
      {
        success: true,
        data: newEntry
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('❌ Error submitting feedback:', error);
    return NextResponse.json(
      { error: 'Failed to submit feedback. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/feedback
 * List feedback (admin & moderator only)
 */
export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;

    // Get user role from Firestore
    const { db } = await import('@/lib/firebase-admin');
    const adminDoc = await db.collection('admins').doc(userId).get();
    const moderatorDoc = await db.collection('moderators').doc(userId).get();

    if (!adminDoc.exists && !moderatorDoc.exists) {
      return NextResponse.json(
        { error: 'Access denied. Admin or Moderator role required.' },
        { status: 403 }
      );
    }

    // Read feedback from Firestore
    let entries = await readFeedback();

    // Trigger cleanup of expired feedback (lazy cleanup)
    // Only updates DB, returns filtered list if needed, but readFeedback() already returns all currently in DB.
    // If cleanup runs, next read will be cleaner.
    // For consistency, we can filter the returned list too based on cleanup logic response.
    entries = await cleanupOldFeedback(entries);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const query = searchParams.get('q') || '';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // Filter by search query (in-memory since we fetched all)
    // For production, use Algolia or Typesense or separate collection
    // Filter by search query (in-memory since we fetched all)
    // For production, use Algolia or Typesense or separate collection
    let filtered = entries;
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(entry =>
        entry.name.toLowerCase().includes(lowerQuery) ||
        entry.email.toLowerCase().includes(lowerQuery) ||
        entry.message.toLowerCase().includes(lowerQuery) ||
        entry.user_id.toLowerCase().includes(lowerQuery)
      );
    }

    // Filter by date range
    if (from) {
      const fromDate = new Date(from);
      filtered = filtered.filter(entry => new Date(entry.created_at) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999); // End of day
      filtered = filtered.filter(entry => new Date(entry.created_at) <= toDate);
    }

    // Sort by created_at descending (newest first)
    filtered.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Paginate
    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedEntries = filtered.slice(startIndex, endIndex);

    return NextResponse.json({
      success: true,
      total,
      page,
      limit,
      items: paginatedEntries
    });

  } catch (error: any) {
    console.error('❌ Error fetching feedback:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    );
  }
}
