/**
 * deploy.js — Post-deployment build script for Plesk Git integration (Windows)
 *
 * Run this after every git pull:
 *   node deploy.js
 *
 * What it does:
 *   1. Creates frontend/.env if missing
 *   2. npm install in frontend/
 *   3. npm run build in frontend/ → produces frontend/dist/
 *   4. npm install --omit=dev in root (backend deps)
 *
 * Result structure:
 *   httpdocs/
 *   ├── app.js
 *   ├── package.json
 *   ├── web.config
 *   ├── node_modules/
 *   └── frontend/
 *       └── dist/   ← served as static files by app.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FRONTEND_DIR = path.join(ROOT, 'frontend');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd || ROOT, shell: true });
}

console.log('\n========================================');
console.log('  MeetSpace Deployment Script');
console.log('========================================');
console.log(`  Root: ${ROOT}`);
console.log(`  Node: ${process.version}`);
console.log('========================================\n');

// ─── Step 1: Create frontend/.env if missing ─────────────────────────────────
const frontendEnvPath = path.join(FRONTEND_DIR, '.env');
if (!fs.existsSync(frontendEnvPath)) {
  fs.writeFileSync(frontendEnvPath, 'VITE_SOCKET_URL=https://meetspace.swiftcampus.com\n');
  console.log('✅ Created frontend/.env with production VITE_SOCKET_URL');
} else {
  console.log('✅ frontend/.env already exists');
}

// ─── Step 2: Install frontend dependencies ────────────────────────────────────
console.log('\n📦 Step 2: Installing frontend dependencies...');
run('npm install', FRONTEND_DIR);
console.log('✅ Frontend dependencies installed');

// ─── Step 3: Build frontend ───────────────────────────────────────────────────
console.log('\n🔨 Step 3: Building frontend for production...');
run('npm run build', FRONTEND_DIR);
console.log('✅ Frontend built → frontend/dist/');

// ─── Step 4: Install backend dependencies ────────────────────────────────────
console.log('\n📦 Step 4: Installing backend (root) dependencies...');
run('npm install --omit=dev', ROOT);
console.log('✅ Backend dependencies installed');

// ─── Done ─────────────────────────────────────────────────────────────────────
console.log('\n========================================');
console.log('  ✅ Deployment Complete!');
console.log('  → Restart the Node.js app in Plesk');
console.log('========================================\n');
