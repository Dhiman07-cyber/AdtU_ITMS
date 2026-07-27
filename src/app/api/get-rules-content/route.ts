import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

export const GET = withSecurity(
    async () => {
        try {
            const rulesPath = path.join(process.cwd(), 'firestore.rules');
            const rulesContent = await fs.readFile(rulesPath, 'utf8');

            return NextResponse.json({
                success: true,
                content: rulesContent
            });
        } catch (error: any) {
            console.error('Error reading firestore.rules:', error);
            return NextResponse.json({
                success: false,
                error: 'Failed to read firestore.rules file'
            }, { status: 500 });
        }
    },
    {
        requiredRoles: [],
        schema: EmptySchema,
        rateLimit: RateLimits.READ,
    }
);
