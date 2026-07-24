import { headers } from 'next/headers';
import { User, Student, Driver, Moderator } from '@/lib/types';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { cert } from 'firebase-admin/app';

import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { incrementBusCapacity } from '@/domains/fleet';
import { createUser, createStudent, createDriver, getStudentById } from '@/domains/identity';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { assignDriverToBus } from '@/domains/fleet/repositories/driver-assignment.repository';

let adminApp: any;
let auth: any;
let db: any;
let useAdminSDK = false;

// Get the data directory path


// Try to initialize Firebase Admin SDK
try {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    if (!getApps().length) {
      // Fix private key parsing issue
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, '\n').replace(/"/g, '');
      adminApp = initializeApp({
        credential: cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
      });
    } else {
      adminApp = getApps()[0];
    }

    auth = getAuth(adminApp);
    db = getFirestore(adminApp);
    useAdminSDK = true;
  }
} catch (error) {
  console.log('Failed to initialize Firebase Admin SDK, falling back to client SDK:', error);
  useAdminSDK = false;
}

export async function POST(request: Request) {
  try {
    // Check if user is moderator or admin
    const authHeader = (await headers()).get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Track current user info for audit trail
    let currentUserRole: string = '';
    let currentUserEmployeeId: string = 'MOD';
    let currentUserName: string = 'System';

    // Verify the token with Firebase Admin SDK
    if (useAdminSDK && auth) {
      try {
        const decodedToken = await auth.verifyIdToken(token);
        const currentUserUid = decodedToken.uid;

        const roleData = await resolveUserRole(currentUserUid);
        currentUserRole = roleData.role;

        if (currentUserRole !== 'admin' && currentUserRole !== 'moderator') {
          return new Response(JSON.stringify({
            success: false,
            error: 'Forbidden: User is not a moderator or admin'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const updaterInfo = await getUpdaterInfo(db, currentUserUid);
        currentUserName = updaterInfo.name;
        currentUserEmployeeId = currentUserRole === 'admin' ? 'Admin' : updaterInfo.roleOrEmployeeId;
      } catch (error) {
        console.error('Error verifying token:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid token'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const userData = await request.json();
    console.log('Received user data:', userData);

    const {
      email,
      name,
      role,
      phone,
      alternatePhone,
      profilePhotoUrl,
      enrollmentId,
      gender,
      faculty,
      department,
      parentName,
      parentPhone,
      dob,
      licenseNumber,
      joiningDate,
      assignedFaculty,
      permissions,
      aadharNumber,
      staffId,
      employeeId,
      routeId,
      busId,
      address,
      bloodGroup,
      shift,
      approvedBy,
      // Session fields for students
      sessionDuration,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      pickupPoint
    } = userData;

    // Validate required input
    if (!email || !name || !role) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Email, name, and role are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Prevent moderators from creating other moderators or admins
    if (useAdminSDK && auth) {
      try {
        const decodedToken = await auth.verifyIdToken(token);
        const callerRole = await resolveUserRole(decodedToken.uid);

        if (callerRole.role === 'moderator' && (role === 'moderator' || role === 'admin')) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Forbidden: Moderators cannot create other moderators or admins'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (error) {
        console.error('Error checking user permissions:', error);
      }
    }


    // Fetch deadline config for student validity calculations
    const deadlineConfig = await getDeadlineConfig();

    if (useAdminSDK && db) {
      // Use Firebase Admin SDK
      try {
        // For Google authentication, we don't create users with email/password
        // Instead, we check if the user already exists in Firebase Auth
        let uid: string;
        try {
          const userRecord = await auth.getUserByEmail(email);
          uid = userRecord.uid;
          console.log('Found existing Firebase user with UID:', uid);
        } catch (error: any) {
          // If user doesn't exist in Firebase Auth, we'll create them
          console.log('User does not exist in Firebase Auth, creating them now');
          const userRecord = await auth.createUser({
            email: email,
            emailVerified: true
          });
          uid = userRecord.uid;
          console.log('Created Firebase user with UID:', uid);
        }

        // Create user document in users collection
        const userDocData: any = {
          uid, // Set the actual Firebase Auth UID
          email,
          name,
          role,
          createdAt: new Date().toISOString()
        };

        // Write user to PostgreSQL (canonical source of truth) — before transaction
        await createUser({
          uid,
          email,
          name,
          role,
          createdAt: userDocData.createdAt,
        });

        // Create role-specific document
        if (role === 'student') {
          const finalValidUntilStr = validUntil || calculateValidUntilDate(sessionStartYear || new Date().getUTCFullYear(), parseInt(sessionDuration || '1'), deadlineConfig).toISOString();
          const blockDates = computeBlockDatesFromValidUntil(finalValidUntilStr, deadlineConfig);

          const studentDocData: any = {
            uid,
            email,
            fullName: name,
            faculty: faculty || '',
            department: department || '',
            gender: gender || '',
            dob: dob || '',
            phone: phone || '',
            phoneNumber: phone || '',
            altPhone: alternatePhone || '',
            alternatePhone: alternatePhone || '',
            parentName: parentName || '',
            parentPhone: parentPhone || '',
            enrollmentId: enrollmentId || '',
            bloodGroup: bloodGroup || '',
            address: address || '',
            profilePhotoUrl: profilePhotoUrl || '',
            routeId: routeId || null,
            busId: busId || null,
            shift: shift || 'Morning',
            approvedBy: approvedBy || 'System (AUTO_MIGRATION)',
            sessionDuration: sessionDuration || '1',
            sessionStartYear: sessionStartYear || new Date().getFullYear(),
            sessionEndYear: sessionEndYear || (new Date().getFullYear() + 1),
            validUntil: finalValidUntilStr,
            ...blockDates,
            pickupPoint: pickupPoint || '',
            waitingFlag: false,
            boardedFlag: false,
            feesStatus: 'draft',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Atomic student creation with bus capacity increment.
          // Without a transaction, a concurrent create-user on the same bus
          // could overfill beyond capacity, or a failure after user creation
          // leaves an orphan student doc.
          const studentBusId = studentDocData.busId;

          // ponytail: idempotency check MUST happen BEFORE createStudent, not after.
          const existingStudent = await getStudentById(uid);
          const alreadyExisted = !!existingStudent;

          // Write student to PostgreSQL (canonical source of truth)
          await createStudent({
            ...studentDocData,
            uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Increment capacity in PG (source of truth) only if student is new and bus assigned
          if (studentBusId && !alreadyExisted) {
            try {
              await incrementBusCapacity(studentBusId, studentDocData.shift);
            } catch (pgErr) {
              console.warn(`⚠️ moderator/create-user: PG capacity increment failed for bus ${studentBusId}:`, pgErr);
            }
          }
        } else if (role === 'driver') {
          const driverDocData: any = {
            uid, // Set the actual Firebase Auth UID
            email,
            fullName: name,
            licenseNumber: licenseNumber || '',
            aadharNumber: aadharNumber || '',
            phone: phone || '',
            altPhone: alternatePhone || '',
            joiningDate: joiningDate || '',
            address: address || '',
            profilePhotoUrl: profilePhotoUrl || '',
            routeId: routeId || null,
            busId: busId || null,
            shift: shift || 'Both', // Default to Both Shifts if not provided
            approvedBy: approvedBy || 'System (AUTO_MIGRATION)',
            dob: dob || '',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Audit trail - who created/updated this document
          };

          // Write driver to PostgreSQL (canonical source of truth) — before Firestore write
          await createDriver({
            ...driverDocData,
            uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Update bus driver assignment via PG
          if (busId) {
            console.log(`🚌 Updating bus ${busId} with driver ${uid}`);
            try {
              await import('@/domains/fleet').then(m => m.updateBus(busId, { driverUID: uid, activeTripId: null } as any));
              console.log(`   ✅ Bus ${busId} updated successfully`);
            } catch (err) {
              console.warn(`   ⚠️  Bus ${busId} update failed`, err);
            }

            try {
              await assignDriverToBus(uid, busId, {
                assignedBy: 'moderator',
                reason: 'assignment',
              });
            } catch (err) {
              console.warn(`   ⚠️  driver_assignments write failed for ${uid}:`, err);
            }
          }
        }

        return new Response(JSON.stringify({
          success: true,
          message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully. They can sign in with Google using the email provided.`
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (adminError: any) {
        console.error('Error with Admin SDK:', adminError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to create user with Admin SDK'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Fallback to client SDK (existing implementation)
      const { Timestamp } = await import('firebase/firestore');

      // For the fallback implementation, we need to handle the case where we don't have
      // the Firebase Auth UID yet. In a real implementation, the user would sign in
      // with Google first to get their UID, then we'd update their document.
      // For now, we'll use a placeholder that will be updated when they sign in.

      // Create user document in users collection with email-based ID
      // This will be updated with the real UID when the user signs in
      const userDocId = email.replace(/[^a-zA-Z0-9]/g, '_');
      const userDocData: User = {
        uid: userDocId, // Temporary ID, will be updated when user signs in
        email,
        name,
        role,
        createdAt: Timestamp.now()
      };

      // Write user to PostgreSQL (canonical source of truth)
      await createUser({
        uid: userDocId,
        email,
        name,
        role,
        createdAt: new Date().toISOString(),
      });

      // Create role-specific document
      if (role === 'student') {
        const studentDocData: any = {
          uid: userDocId, // Temporary ID, will be updated when user signs in
          email,
          fullName: name,
          faculty: faculty || '',
          department: department || '',
          gender: gender || '',
          dob: dob || '',
          phone: phone || '',
          altPhone: alternatePhone || '',
          parentName: parentName || '',
          parentPhone: parentPhone || '',
          enrollmentId: enrollmentId || '',
          bloodGroup: bloodGroup || '',
          address: address || '',
          profilePhotoUrl: profilePhotoUrl || '',
          routeId: routeId || undefined,
          busId: busId || undefined,
          shift: shift || 'Morning',
          approvedBy: approvedBy || 'System (AUTO_MIGRATION)',
          // Session System fields
          sessionDuration: sessionDuration || '1',
          sessionStartYear: sessionStartYear || new Date().getFullYear(),
          sessionEndYear: sessionEndYear || (new Date().getFullYear() + 1),
          validUntil: validUntil || calculateValidUntilDate(sessionStartYear || new Date().getFullYear(), parseInt(sessionDuration || '1'), deadlineConfig).toISOString(),
          // Block dates computed from sessionEndYear
          ...computeBlockDatesFromValidUntil(validUntil || calculateValidUntilDate(sessionStartYear || new Date().getFullYear(), parseInt(sessionDuration || '1'), deadlineConfig).toISOString(), deadlineConfig),
          waitingFlag: false,
          boardedFlag: false,
          feesStatus: 'draft',
          createdAt: Timestamp.now(),
          // Audit trail - who created/updated this document
        };

        // ponytail: idempotency check BEFORE createStudent for fallback path
        const existingStudentFallback = await getStudentById(userDocId);
        const alreadyExistedFallback = !!existingStudentFallback;

        // Create role-specific document via PG
        await createStudent({
          ...studentDocData,
          uid: userDocId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Increment capacity in PG only if student is new and bus assigned
        if (busId && !alreadyExistedFallback) {
          try {
            await incrementBusCapacity(busId, studentDocData.shift);
          } catch (pgErr) {
            console.warn(`⚠️ moderator/create-user (fallback): PG capacity increment failed for bus ${busId}:`, pgErr);
          }
        }
      } else if (role === 'driver') {
        const driverDocData: any = {
          uid: userDocId, // Temporary ID, will be updated when user signs in
          email,
          fullName: name,
          licenseNumber: licenseNumber || '',
          aadharNumber: aadharNumber || '',
          phone: phone || '',
          altPhone: alternatePhone || '',
          joiningDate: joiningDate || '',
          address: address || '',
          profilePhotoUrl: profilePhotoUrl || '',
          routeId: routeId || undefined,
          busId: busId || undefined,
          shift: shift || 'Both',
          approvedBy: approvedBy || 'System (AUTO_MIGRATION)',
          dob: dob || '',
          status: 'active',
          createdAt: Timestamp.now(),
          // Audit trail - who created/updated this document
        };

        // Create driver via PG (canonical source of truth)
        await createDriver({
          ...driverDocData,
          uid: userDocId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Update bus driver assignment via PG
        if (busId) {
          try {
            const { updateBus } = await import('@/domains/fleet');
            await updateBus(busId, { driverUID: userDocId, activeTripId: null } as any);
          } catch (err) {
            console.warn('Failed to update bus in fallback mode', err);
          }

          try {
            await assignDriverToBus(userDocId, busId, {
              assignedBy: 'moderator',
              reason: 'assignment',
            });
          } catch (err) {
            console.warn('Failed to write driver_assignments in fallback mode', err);
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully. They can sign in with Google using the email provided.`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error: any) {
    console.error('Error creating user:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to create user'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
