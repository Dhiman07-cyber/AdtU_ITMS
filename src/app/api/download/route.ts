
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeExternalUrl } from '@/lib/security/url-sanitizer';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

const ALLOWED_DOWNLOAD_HOSTS = new Set([
    'res.cloudinary.com',
    'firebasestorage.googleapis.com',
]);

function isAllowedDownloadUrl(value: string): string | null {
    const parsed = safeExternalUrl(value);
    if (!parsed) return null;
    const url = new URL(parsed);
    const host = url.hostname.toLowerCase();
    if (ALLOWED_DOWNLOAD_HOSTS.has(host) || host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) {
        return url.toString();
    }
    return null;
}

function safeFilename(value: string): string {
    const cleaned = value
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 120);
    return cleaned || 'file';
}

export const GET = withSecurity(
    async (request, { requestId }) => {
        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const fileUrl = searchParams.get('url');
        const filename = safeFilename(searchParams.get('filename') || 'file');

        if (!fileUrl) {
            return NextResponse.json({ error: 'Missing file URL' }, { status: 400 });
        }

        const safeUrl = isAllowedDownloadUrl(fileUrl);
        if (!safeUrl) {
            return NextResponse.json({ error: 'Unsupported download source' }, { status: 400 });
        }

        try {
            const response = await fetch(safeUrl, { redirect: 'error' });

            if (!response.ok) {
                console.error('Failed to fetch download source');
                return NextResponse.json({ error: 'Failed to fetch file from source' }, { status: 502 });
            }

            // Bound memory: reject oversized bodies before buffering.
            const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
            const declaredLength = Number(response.headers.get('content-length') || 0);
            if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
                return NextResponse.json({ error: 'File too large' }, { status: 413 });
            }

            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const reader = response.body?.getReader();
            if (!reader) {
                return NextResponse.json({ error: 'Failed to fetch file from source' }, { status: 502 });
            }
            const chunks: Uint8Array[] = [];
            let received = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.byteLength;
                if (received > MAX_DOWNLOAD_BYTES) {
                    try { await reader.cancel(); } catch { /* ignore */ }
                    return NextResponse.json({ error: 'File too large' }, { status: 413 });
                }
                chunks.push(value);
            }
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const buffer = Buffer.allocUnsafe(total);
            let offset = 0;
            for (const c of chunks) {
                buffer.set(c, offset);
                offset += c.byteLength;
            }

            return new NextResponse(buffer, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Content-Length': buffer.length.toString(),
                },
            });

        } catch (error) {
            console.error('Download proxy error:', error);
            return NextResponse.json({ error: 'Internal server error during download' }, { status: 500 });
        }
    },
    {
        requiredRoles: [],
        schema: EmptySchema,
        rateLimit: RateLimits.READ,
    }
);
