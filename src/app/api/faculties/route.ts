import facultiesData from '@/data/faculties_departments.json';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // SECURITY: Use static import to avoid filesystem issues in serverless/proxy environments
    if (!facultiesData || !Array.isArray(facultiesData)) {
      throw new Error('Faculties data is malformed or missing');
    }

    return NextResponse.json(facultiesData, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Error loading faculties data:', error);
    return NextResponse.json(
      { error: 'Failed to load faculties data' },
      { status: 500 }
    );
  }
}