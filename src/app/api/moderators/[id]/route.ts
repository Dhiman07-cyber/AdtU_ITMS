import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { getModeratorById } from '@/domains/identity';

// Define types for our data
interface Moderator {
  id: string;
  name: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  faculty?: string;
  assignedFaculty?: string;
  joinDate?: string;
  joiningDate?: string;
  profilePhotoUrl?: string;
  dob?: string;
  aadharNumber?: string;
  employeeId?: string;
  createdAt?: string;
  [key: string]: any;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const { id } = await params;

    // Read from PostgreSQL (single source of truth)
    const modData = await getModeratorById(id);

    if (!modData) {
      return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
    }

    // Format the date of birth to ensure it's in YYYY-MM-DD format
    let formattedDob = '';
    if (modData.dob) {
      if (typeof modData.dob === 'string') {
        formattedDob = modData.dob;
      } else if (modData.dob.toDate) {
        formattedDob = modData.dob.toDate().toISOString().split('T')[0];
      } else {
        formattedDob = new Date(modData.dob).toISOString().split('T')[0];
      }
    }

    // Format the joining date to ensure it's in YYYY-MM-DD format
    let formattedJoiningDate = '';
    const joiningDateValue = modData.joiningDate || modData.joinDate;
    if (joiningDateValue) {
      if (typeof joiningDateValue === 'string') {
        formattedJoiningDate = joiningDateValue;
      } else if (joiningDateValue.toDate) {
        formattedJoiningDate = joiningDateValue.toDate().toISOString().split('T')[0];
      } else {
        formattedJoiningDate = new Date(joiningDateValue).toISOString().split('T')[0];
      }
    }

    const moderator: Moderator = {
      id,
      name: modData.fullName || modData.name || '',
      email: modData.email || '',
      phone: modData.phone || '',
      alternatePhone: modData.alternatePhone || '',
      faculty: modData.faculty || '',
      assignedFaculty: modData.assignedFaculty || modData.faculty || '',
      joinDate: formattedJoiningDate,
      joiningDate: formattedJoiningDate,
      profilePhotoUrl: modData.profilePhotoUrl || '',
      dob: formattedDob,
      aadharNumber: modData.aadharNumber || '',
      employeeId: modData.employeeId || '',
      createdAt: modData.createdAt || '',
    };

    return NextResponse.json(moderator);
  } catch (error) {
    console.error('Error fetching moderator:', error);
    return NextResponse.json({ error: 'Failed to fetch moderator' }, { status: 500 });
  }
}
