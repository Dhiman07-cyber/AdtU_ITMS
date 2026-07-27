import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ReleaseManifest {
    version: string;
    appName: string;
    buildTimestamp: string;
    gitCommitHash: string;
    gitBranch: string;
    environment: string;
    nodeVersion: string;
    targetArchitecture: string;
    containerImages: {
        app: string;
        websocket: string;
        nginx: string;
    };
    services: string[];
}

function getGitMetadata(): { commitHash: string; branch: string } {
    try {
        const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
        const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
        return { commitHash, branch };
    } catch {
        return { commitHash: 'unknown', branch: 'unknown' };
    }
}

export function generateReleaseManifest(): ReleaseManifest {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const git = getGitMetadata();
    const version = pkg.version || '1.0.0';

    const manifest: ReleaseManifest = {
        version,
        appName: 'ITMS ADTU Bus Services',
        buildTimestamp: new Date().toISOString(),
        gitCommitHash: git.commitHash,
        gitBranch: git.branch,
        environment: process.env.NODE_ENV || 'production',
        nodeVersion: process.version,
        targetArchitecture: 'x86_64-linux-gnu',
        containerImages: {
            app: `itms/app:${version}`,
            websocket: `itms/ws:${version}`,
            nginx: `nginx:1.27-alpine`
        },
        services: ['nextjs', 'ws1', 'ws2', 'nginx', 'prometheus', 'alertmanager', 'grafana']
    };

    const outputDir = path.join(__dirname, '../public');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'release-manifest.json');
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`✅ Release manifest generated successfully at ${outputPath}`);

    return manifest;
}

if (require.main === module) {
    generateReleaseManifest();
}
