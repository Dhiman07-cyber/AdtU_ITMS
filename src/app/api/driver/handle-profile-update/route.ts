import { NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebase-admin';
import { v2 as cloudinary } from 'cloudinary';
import { withSecurity } from '@/lib/security/api-security';
import { HandleProfileUpdateSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getBusById, getAllBuses } from '@/domains/fleet';
import { getStudentById, updateStudent } from '@/domains/identity';

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
    const assignedBusId = studentData.assignedBusId || studentData.busId;
    if (assignedBusId) {
      const busData = await getBusById(assignedBusId);
      if (busData) {
        if ((busData as any).assignedDriverId === driverUid || busData.driverUID === driverUid) {
          isAuthorized = true;
        }
      }
    }

    // Also check if driver is assigned to any bus that has this student
    if (!isAuthorized) {
      const allBuses = await getAllBuses();
      const driverBuses = allBuses.filter(b => (b as any).assignedDriverId === driverUid);

      for (const bus of driverBuses) {
        const busId = bus.busId || bus.id || '';
        if (assignedBusId === busId) {
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

    if (action === 'approve') {
      // Delete the old profile photo from Cloudinary if it exists
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

      // Check current status in Firestore
      const requestRef = adminDb.collection('profile_update_requests').doc(requestId);
      const freshRequest = await requestRef.get();
      if (!freshRequest.exists || freshRequest.data()?.status !== 'pending') {
        return NextResponse.json({ success: true, message: 'Request already processed' });
      }

      // ─── COMMIT TO POSTGRESQL (Canonical Source of Truth) ───
      await updateStudent(requestData.studentUid, {
        profilePhotoUrl: requestData.newImageUrl,
        fullName: requestData.newName,
        pendingProfileUpdate: null
      });

      // Update request status in Firestore
      try {
        await requestRef.update({
          status: 'approved',
          approvedAt: new Date().toISOString(),
          approvedBy: driverUid,
          updatedAt: new Date().toISOString()
        });
      } catch (fsErr) {
        console.error('⚠️ Firestore mirroring failed during approval:', fsErr);
      }

      console.log(`Profile update approved for student ${requestData.studentUid}: ${requestId}`);

      return NextResponse.json({
        success: true,
        message: 'Profile update approved successfully'
      });
    } else {
      // action === 'reject'
      // Delete the new profile photo from Cloudinary since it's being rejected
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

      // Check current status in Firestore
      const requestRef = adminDb.collection('profile_update_requests').doc(requestId);
      const freshRequest = await requestRef.get();
      if (!freshRequest.exists || freshRequest.data()?.status !== 'pending') {
        return NextResponse.json({ success: true, message: 'Request already processed' });
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