/**
 * Canonical Infrastructure Environment Validator
 * 
 * Classifies all environment variables across Public, Private, Secret, Build-Time,
 * and Runtime categories. Performs deterministic fail-fast boot checks for production readiness.
 */

export interface EnvClassification {
    name: string;
    category: 'public' | 'private' | 'secret';
    lifecycle: 'build-time' | 'runtime' | 'both';
    required: boolean;
    description: string;
}

export const ENV_CATALOG: EnvClassification[] = [
    // --- Public / Client ---
    { name: 'NEXT_PUBLIC_FIREBASE_API_KEY', category: 'public', lifecycle: 'build-time', required: true, description: 'Firebase Web API Key' },
    { name: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', category: 'public', lifecycle: 'build-time', required: true, description: 'Firebase Auth Domain' },
    { name: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', category: 'public', lifecycle: 'build-time', required: true, description: 'Firebase Project ID' },
    { name: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', category: 'public', lifecycle: 'build-time', required: true, description: 'Firebase Storage Bucket' },
    { name: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', category: 'public', lifecycle: 'build-time', required: true, description: 'FCM Sender ID' },
    { name: 'NEXT_PUBLIC_FIREBASE_APP_ID', category: 'public', lifecycle: 'build-time', required: true, description: 'Firebase App ID' },
    { name: 'NEXT_PUBLIC_SUPABASE_URL', category: 'public', lifecycle: 'build-time', required: true, description: 'Supabase Project URL' },
    { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', category: 'public', lifecycle: 'build-time', required: true, description: 'Supabase Public Anon Key' },
    { name: 'NEXT_PUBLIC_APP_URL', category: 'public', lifecycle: 'build-time', required: true, description: 'Canonical Public Application URL' },
    { name: 'NEXT_PUBLIC_WS_URL', category: 'public', lifecycle: 'build-time', required: true, description: 'Canonical WebSocket Endpoint URL' },
    { name: 'NEXT_PUBLIC_RAZORPAY_KEY_ID', category: 'public', lifecycle: 'build-time', required: true, description: 'Razorpay Public Key ID' },
    { name: 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', category: 'public', lifecycle: 'build-time', required: false, description: 'Cloudinary Cloud Name' },
    { name: 'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', category: 'public', lifecycle: 'build-time', required: false, description: 'Cloudinary Upload Preset' },
    { name: 'NEXT_PUBLIC_CLOUDINARY_UPLOAD_ASSET_FOLDER', category: 'public', lifecycle: 'build-time', required: false, description: 'Cloudinary Upload Asset Folder' },

    // --- Private / Server Runtime ---
    { name: 'NODE_ENV', category: 'private', lifecycle: 'runtime', required: true, description: 'Node environment (development/production/test)' },
    { name: 'WS_PORT', category: 'private', lifecycle: 'runtime', required: false, description: 'WebSocket server port (default: 3001)' },
    { name: 'HEALTH_PORT', category: 'private', lifecycle: 'runtime', required: false, description: 'WS Health/Metrics port (default: 9090)' },
    { name: 'LOG_LEVEL', category: 'private', lifecycle: 'runtime', required: false, description: 'Structured logger level (info/warn/error/debug)' },
    { name: 'WS_SERVER_URL', category: 'private', lifecycle: 'runtime', required: false, description: 'Internal / Remote WebSocket endpoint for Next.js server-side transport' },
    { name: 'WS_HOST', category: 'private', lifecycle: 'runtime', required: false, description: 'Fallback WebSocket host (default: 127.0.0.1)' },

    // --- Secrets ---
    { name: 'FIREBASE_CLIENT_EMAIL', category: 'secret', lifecycle: 'runtime', required: true, description: 'Firebase Admin Service Account Email' },
    { name: 'FIREBASE_PRIVATE_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'Firebase Admin RSA Private Key' },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'Supabase Admin Service Role Key' },
    { name: 'RAZORPAY_KEY_ID', category: 'secret', lifecycle: 'runtime', required: true, description: 'Razorpay Key ID' },
    { name: 'RAZORPAY_KEY_SECRET', category: 'secret', lifecycle: 'runtime', required: true, description: 'Razorpay Secret Key' },
    { name: 'RAZORPAY_WEBHOOK_SECRET', category: 'secret', lifecycle: 'runtime', required: true, description: 'Razorpay Webhook Verification Secret' },
    { name: 'CLOUDINARY_API_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'Cloudinary API Key' },
    { name: 'CLOUDINARY_API_SECRET', category: 'secret', lifecycle: 'runtime', required: true, description: 'Cloudinary API Secret' },
    { name: 'CRON_SECRET', category: 'secret', lifecycle: 'runtime', required: true, description: 'Vercel / Scheduled Cron Authorization Token' },
    { name: 'ENCRYPTION_SECRET_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'AES-256 Symmetric Encryption Master Key' },
    { name: 'SIGNING_SECRET_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'HMAC Signing Master Key' },
    { name: 'RECEIPT_SIGNING_SECRET', category: 'secret', lifecycle: 'runtime', required: true, description: 'Payment Receipt HMAC Signing Secret' },
    { name: 'DOCUMENT_PRIVATE_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'Document RSA Private Key' },
    { name: 'DOCUMENT_PUBLIC_KEY', category: 'secret', lifecycle: 'runtime', required: true, description: 'Document RSA Public Key' },
    { name: 'WS_PRIVILEGED_TOKEN', category: 'secret', lifecycle: 'runtime', required: true, description: 'WebSocket Internal System Broadcast Token' },
];

export interface EnvironmentValidationResult {
    valid: boolean;
    missing: string[];
    warnings: string[];
    summary: Record<string, string>;
}

export function assertPrivilegedTokenSafe(
    token: string | undefined = process.env.WS_PRIVILEGED_TOKEN,
    env: string = process.env.NODE_ENV || 'development'
): void {
    if (env === 'production') {
        if (!token || token.trim() === '' || token === '__server__') {
            throw new Error('WS_PRIVILEGED_TOKEN is missing or insecure in production.');
        }
    }
}

export function validateEnvironment(options?: { isWebSocketServer?: boolean }): EnvironmentValidationResult {
    const missing: string[] = [];
    const warnings: string[] = [];
    const summary: Record<string, string> = {};

    const requiredKeys = options?.isWebSocketServer
        ? ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'WS_PRIVILEGED_TOKEN']
        : ENV_CATALOG.filter(e => e.required).map(e => e.name);

    for (const item of ENV_CATALOG) {
        const value = process.env[item.name];
        if (!value || value.trim() === '') {
            if (requiredKeys.includes(item.name)) {
                missing.push(item.name);
            } else if (item.required) {
                warnings.push(`Optional or non-critical env var missing: ${item.name}`);
            }
            summary[item.name] = 'MISSING';
        } else {
            summary[item.name] = item.category === 'secret' ? '[PRESENT_SECRET]' : value;
        }
    }

    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
        const wsToken = process.env.WS_PRIVILEGED_TOKEN;
        if (!wsToken || wsToken.trim() === '' || wsToken === '__server__') {
            if (!missing.includes('WS_PRIVILEGED_TOKEN')) {
                missing.push('WS_PRIVILEGED_TOKEN');
            }
            warnings.push('WS_PRIVILEGED_TOKEN is missing or insecure in production.');
        }
    }

    const valid = missing.length === 0;

    if (!valid && isProd) {
        console.error(`❌ [ENV_VALIDATION_FAILED] Production startup halted due to missing required variables: ${missing.join(', ')}`);
    } else if (!valid) {
        console.warn(`⚠️ [ENV_VALIDATION_WARNING] Non-production boot missing variables: ${missing.join(', ')}`);
    }

    return {
        valid,
        missing,
        warnings,
        summary
    };
}
