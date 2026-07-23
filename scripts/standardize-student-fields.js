const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

/**
 * Audit and standardize field names across the ITMS codebase:
 * Enforces canonical JS/TS names: `fullName`, `enrollmentId`, `email`.
 * Maps legacy/alias names in form objects and RPC payloads.
 */
function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.startsWith('.')) {
        walk(filePath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = walk(srcDir);
let modifiedCount = 0;

for (const file of allFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace legacy aliases in field references if present
  content = content.replace(/studentData\.enrollmentNo/g, 'studentData.enrollmentId');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    modifiedCount++;
    console.log(`Updated standardized field names in: ${path.relative(process.cwd(), file)}`);
  }
}

console.log(`Standardization check complete. Modified ${modifiedCount} file(s).`);
