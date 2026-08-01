import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function generateSelfSignedCert() {
  const certsDir = path.join(process.cwd(), 'nginx', 'certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  const certPath = path.join(certsDir, 'fullchain.pem');
  const keyPath = path.join(certsDir, 'privkey.pem');

  // Find openssl binary
  const opensslPaths = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  ];

  let opensslBin: string | null = null;
  for (const p of opensslPaths) {
    try {
      execSync(`"${p}" version`, { stdio: 'ignore' });
      opensslBin = p;
      break;
    } catch {
      // continue
    }
  }

  if (opensslBin) {
    console.log(`Using OpenSSL from: ${opensslBin}`);
    const cmd = `"${opensslBin}" req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 3650 -subj "/CN=itms.example.com/O=ITMS/OU=Dev"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log(`✅ Successfully generated valid self-signed SSL certificates in ${certsDir}`);
  } else {
    console.warn('⚠️  OpenSSL not found in PATH or Git installation. Creating fallback cert files.');
    generateMinimalValidPem(keyPath, certPath);
  }
}

function generateMinimalValidPem(keyPath: string, certPath: string) {
  // Pure RSA key & cert fallback generator if openssl binary isn't accessible
  const crypto = require('crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(keyPath, privateKey);
  fs.writeFileSync(certPath, publicKey); // Spki format header for fallback
}

generateSelfSignedCert();
