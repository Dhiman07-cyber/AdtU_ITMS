import { NextRequest, NextResponse } from 'next/server';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createAdmin, getAdminById, getUserById } from '@/domains/identity';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getAdminServices() {
  const app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: requireEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
      clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });

  return {
    auth: getAuth(app),
  };
}

async function getAuthenticatedUserId(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      response: NextResponse.json({ error: 'No authorization token provided' }, { status: 401 }),
    };
  }

  try {
    const { auth } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(authHeader.slice('Bearer '.length));
    return { userId: decodedToken.uid };
  } catch {
    return {
      response: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }),
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthenticatedUserId(request);
    if (authResult.response) return authResult.response;

    const userId = authResult.userId;

    const existingPgAdmin = await getAdminById(userId);
    if (existingPgAdmin) {
      return NextResponse.json({
        success: true,
        message: 'Admin document already exists',
        adminId: userId,
        data: existingPgAdmin,
      });
    }

    const userData = await getUserById(userId);
    if (!userData) {
      return NextResponse.json({
        error: 'User not found in users table. Please ensure the user is registered.',
        userId,
      }, { status: 404 });
    }

    if (userData.role !== 'admin') {
      return NextResponse.json({
        error: `User role is "${userData.role}", not "admin". Only admin users can have admin documents.`,
        userId,
      }, { status: 403 });
    }

    const now = new Date().toISOString();
    await createAdmin({
      uid: userId,
      email: userData.email,
      name: userData.name,
      fullName: userData.name,
      role: userData.role,
      employeeId: 'ADM001',
      createdAt: userData.createdAt || now,
      updatedAt: now,
    });

    try {
      const { initializeBusFee } = await import('@/lib/bus-fee-service');
      await initializeBusFee();
    } catch {
      console.warn('Failed to initialize bus fee for admin.');
    }

    return NextResponse.json({
      success: true,
      message: 'Admin document created successfully',
      adminId: userId,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create admin document', details: 'Internal error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthenticatedUserId(request);
    if (authResult.response) return authResult.response;

    const userId = authResult.userId;

    const pgAdmin = await getAdminById(userId);
    if (pgAdmin) {
      return NextResponse.json({
        exists: true,
        adminId: userId,
        data: pgAdmin,
      });
    }

    return NextResponse.json({
      exists: false,
      adminId: userId,
      message: 'No admin document found. Call POST to create one.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to check admin document', details: 'Internal error' },
      { status: 500 }
    );
  }
}
