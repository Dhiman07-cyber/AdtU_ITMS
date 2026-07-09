import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getDriversByStatus } from '@/domains/identity';

export const GET = withSecurity(
    async (request, { auth, requestId }) => {
        const driverRows = await getDriversByStatus('active');

        const drivers = driverRows
            .filter((data: any) => {
                const hasValidData = data.email && (data.name || data.fullName);
                return hasValidData;
            })
            .map((data: any) => ({
                id: data.uid,
                name: data.name || data.fullName || 'Unknown Driver',
                fullName: data.fullName || data.name || 'Unknown Driver',
                employeeId: data.employeeId || data.driverId || data.empId || 'N/A',
                driverId: data.employeeId || data.driverId || 'N/A',
                email: data.email,
                phone: data.phone || data.phoneNumber,
                assignedBusId: data.assignedBusId || data.busAssigned || null,
                assignedRouteId: data.assignedRouteId || data.routeId || null,
                role: 'driver',
                active: data.status === 'active',
            }));

        return NextResponse.json({
            success: true,
            drivers
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ,
    }
);
