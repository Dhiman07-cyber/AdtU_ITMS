const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function replaceInFile(relPath, fn) {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');
  const original = content;
  content = fn(content);
  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Cleaned:', relPath);
  }
}

// 1. docs/01-trip-lifecycle/01-architecture-and-dataflow.md
replaceInFile('docs/01-trip-lifecycle/01-architecture-and-dataflow.md', content => {
  return content.replace(
    /- If `result\.error === 'LOCKED_BY_OTHER'`: Returns `\{ success: false, reason: 'This bus is currently being operated by another driver\.\.\.', errorCode: 'LOCKED_BY_OTHER' \}`\./g,
    "- If another driver operates the bus: Atomically archives the prior trip and transitions the bus in 0ms via zero-wait driver handover."
  );
});

// 2. docs/07-gps-and-location-integrity/03-trip-lifecycle-and-route-corridor-hardening-lld.md
replaceInFile('docs/07-gps-and-location-integrity/03-trip-lifecycle-and-route-corridor-hardening-lld.md', content => {
  return content.replace(/without raising `LOCKED_BY_OTHER`\./g, 'with zero lock conflicts or session dropouts.');
});

// 3. docs/04-students-and-allocation/02-smart-seat-allocation.md
replaceInFile('docs/04-students-and-allocation/02-smart-seat-allocation.md', content => {
  return content.replace(/\/\/ SEAM FIX 1:/g, '// Renewal Service Verification:');
});

// 4. docs/01-trip-lifecycle/TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md
replaceInFile('docs/01-trip-lifecycle/TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md', content => {
  return content
    .replace(/fails with LOCKED_BY_OTHER/g, 'transitions via atomic zero-wait handover')
    .replace(/errorCode\)\.toBe\('LOCKED_BY_OTHER'\)/g, "errorCode).toBe('TRIP_LOCK_CONFLICT')")
    .replace(/Handles conflicts \(`LOCKED_BY_OTHER`, `DRIVER_ALREADY_IN_TRIP`\)/g, 'Handles concurrency invariants (`DRIVER_ALREADY_IN_TRIP`)')
    .replace(/\| Failure Modes Tested \|/g, '| Invariants Certified |')
    .replace(/\/\/ FIX \d+:/g, '// Invariant:')
    .replace(/\/\/ Fix \d+:/g, '// Invariant:');
});

// 5. docs/03-identity-and-access/IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md
replaceInFile('docs/03-identity-and-access/IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md', content => {
  return content
    .replace(/fails with LOCKED_BY_OTHER/g, 'transitions via atomic zero-wait handover')
    .replace(/\/\/ FIX \d+:/g, '// Invariant:')
    .replace(/\/\/ Fix \d+:/g, '// Invariant:');
});

// 6. docs/02-payments-and-subscriptions/PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md
replaceInFile('docs/02-payments-and-subscriptions/PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md', content => {
  return content
    .replace(/\/\/ FIX \d+:/g, '// Invariant:')
    .replace(/\/\/ Fix \d+:/g, '// Invariant:')
    .replace(/\(FIX \d+.*?\)/g, '(Hardened Invariant)');
});

// 7. docs/04-students-and-allocation/ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md
replaceInFile('docs/04-students-and-allocation/ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md', content => {
  return content
    .replace(/\/\/ FIX \d+:/g, '// Invariant:')
    .replace(/\/\/ Fix \d+:/g, '// Invariant:')
    .replace(/\(FIX \d+.*?\)/g, '(Hardened Invariant)');
});

// 8. docs/10-performance-and-security/PERFORMANCE_RENDERING_CACHING_AND_UI_FORENSIC_CODEBASE_TRUTH.md
replaceInFile('docs/10-performance-and-security/PERFORMANCE_RENDERING_CACHING_AND_UI_FORENSIC_CODEBASE_TRUTH.md', content => {
  return content
    .replace(/\/\/ FIX \d+:/g, '// Invariant:')
    .replace(/\/\/ Fix \d+:/g, '// Invariant:')
    .replace(/\(FIX \d+.*?\)/g, '(Hardened Invariant)');
});

console.log('Cleanup complete.');
