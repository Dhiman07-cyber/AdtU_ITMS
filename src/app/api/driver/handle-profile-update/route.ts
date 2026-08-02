import { getAllBuses,getBusById } from '@/domains/fleet';
import { getStudentById,updateStudent } from '@/domains/identity';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { HandleProfileUpdateSchema } from '@/lib/security/validation-schemas';
import { v2 as cloudinary } from 'cloudinary';
import { NextResponse } from 'next/server';

// Configure Cloudinary
if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * POST /api/driver/handle-profile-update
 * 
 * Approves or rejects a student's profile update request.
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { requestId, action } = body as any;
    const driverUid = auth.uid;

    if (!adminDb) {
      return NextResponse.json({ error: 'Firebase Admin not initialized' }, { status: 500 });
    }

    // Get the profile update request
    const requestDoc = await adminDb.collection('profile_update_requests').doc(requestId).get();
    if (!requestDoc.exists) {
      return NextResponse.json(
        { error: 'Profile update request not found' },
        { status: 404 }
      );
    }

    const requestData = requestDoc.data();
    if (!requestData) {
      return NextResponse.json(
        { error: 'Profile update request details unavailable' },
        { status: 404 }
      );
    }

    // Check if this driver is assigned to the student's bus in PostgreSQL (canonical source of truth)
    const studentData = await getStudentById(requestData.studentUid);
    if (!studentData) {
      return NextResponse.json(
        { error: 'Student not found' },
        { status: 404 }
      );
    }

    let isAuthorized = false;

    // Check if driver is assigned to student's bus (from PG)
    const studentBusId = studentData.busId || studentData.bus_id;
    if (studentBusId) {
      const busData = await getBusById(studentBusId);
      if (busData) {
        if ((busData as any).assignedDriverId === driverUid || busData.driverUID === driverUid) {
          isAuthorized = true;
        }
      }
    }

    // Also check if driver is assigned to any bus that has this student
    if (!isAuthorized) {
      const allBuses = await getAllBuses();
      const driverBuses = allBuses.filter(b => (b as any).assignedDriverId === driverUid || b.driverUID === driverUid);

      for (const bus of driverBuses) {
        const bId = bus.busId || bus.id || '';
        if (bId && studentBusId && bId === studentBusId) {
          isAuthorized = true;
          break;
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: You are not assigned to this student\'s bus' },
        { status: 403 }
      );
    }

    // Perform atomic CAS check on request status in Firestore FIRST
    const requestRef = adminDb.collection('profile_update_requests').doc(requestId);
    let casWon = false;
    try {
      await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(requestRef);
        if (!doc.exists || doc.data()?.status !== 'pending') {
          return;
        }
        transaction.update(requestRef, {
          status: action === 'approve' ? 'approved' : 'rejected',
          processedAt: new Date().toISOString(),
          processedBy: driverUid,
          updatedAt: new Date().toISOString()
        });
        casWon = true;
      });
    } catch (casErr) {
      console.error('CAS transaction error:', casErr);
    }

    if (!casWon) {
      return NextResponse.json({ success: true, message: 'Request already processed' });
    }

    if (action === 'approve') {
      // Delete the old profile photo from Cloudinary if it exists (only after winning CAS)
      if (requestData.currentImageUrl && requestData.currentImageUrl.includes('cloudinary') && cloudinary.config().api_key) {
        try {
          const url = new URL(requestData.currentImageUrl);
          const pathParts = url.pathname.split('/');
          const uploadIndex = pathParts.indexOf('upload');
          if (uploadIndex !== -1 && pathParts.length > uploadIndex + 2) {
            const relevantParts = pathParts.slice(uploadIndex + 2);
            const fullPath = relevantParts.join('/');
            const publicId = fullPath.replace(/\.[^/.]+$/, '');

            if (publicId) {
              const result = await cloudinary.uploader.destroy(publicId);
              console.log(`Cloudinary deletion result for old image (${publicId}):`, result);
            }
          }
        } catch (cloudinaryError) {
          console.error('Error deleting old profile photo from Cloudinary:', cloudinaryError);
        }
      }

      // ─── COMMIT TO POSTGRESQL (Canonical Source of Truth) ───
      await updateStudent(requestData.studentUid, {
        profilePhotoUrl: requestData.newImageUrl,
        fullName: requestData.newName,
        pendingProfileUpdate: null
      });

      console.log(`Profile update approved for student ${requestData.studentUid}: ${requestId}`);

      return NextResponse.json({
        success: true,
        message: 'Profile update approved successfully'
      });
    } else {
      // action === 'reject'
      // Delete the new profile photo from Cloudinary since it's being rejected (only after winning CAS)
      if (requestData.newImageUrl && requestData.newImageUrl.includes('cloudinary') && cloudinary.config().api_key) {
        try {
          const url = new URL(requestData.newImageUrl);
          const pathParts = url.pathname.split('/');
          const uploadIndex = pathParts.indexOf('upload');
          if (uploadIndex !== -1 && pathParts.length > uploadIndex + 2) {
            const relevantParts = pathParts.slice(uploadIndex + 2);
            const fullPath = relevantParts.join('/');
            const publicId = fullPath.replace(/\.[^/.]+$/, '');

            if (publicId) {
              const result = await cloudinary.uploader.destroy(publicId);
              console.log(`Cloudinary deletion result for rejected image (${publicId}):`, result);
            }
          }
        } catch (cloudinaryError) {
          console.error('Error deleting rejected profile photo from Cloudinary:', cloudinaryError);
        }
      }

      // ─── COMMIT TO POSTGRESQL (Canonical Source of Truth) ───
      await updateStudent(requestData.studentUid, {
        pendingProfileUpdate: null
      });

      // Update request status in Firestore
      try {
        await requestRef.update({
          status: 'rejected',
          rejectedAt: new Date().toISOString(),
          rejectedBy: driverUid,
          rejectionReason: 'Driver rejected the request',
          updatedAt: new Date().toISOString()
        });
      } catch (fsErr) {
        console.error('⚠️ Firestore mirroring failed during rejection:', fsErr);
      }

      console.log(`Profile update rejected for student ${requestData.studentUid}: ${requestId}`);

      return NextResponse.json({
        success: true,
        message: 'Profile update request rejected'
      });
    }
  },
  {
    requiredRoles: ['driver'],
    schema: HandleProfileUpdateSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);