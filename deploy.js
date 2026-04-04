/**
 * deploy.js — Post-deployment build script for Plesk Git integration
 *
 * This script is run by Plesk after every git pull.
 * It builds the frontend and copies all files into the flat httpdocs/ structure:
 *
 *   httpdocs/
 *   ├── app.js
 *   ├── package.json
 *   ├── web.config
 *   ├── .env              ← NOT from git (set manually on server)
 *   ├── node_modules/     ← installed by this script
 *   └── dist/             ← built by this script from frontend/src
 *       ├── index.html
 *       └── assets/
 *
 * Usage:
 *   node deploy.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function run(cmd, cwd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd || ROOT });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  ✅ Copied: ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠️  Source not found, skipping: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log(`  ✅ Copied dir: ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
}

// ─── Detect if we're running inside httpdocs (Plesk) or at repo root ──────────
// When Plesk clones the repo, it clones into httpdocs/ directly.
// So __dirname IS httpdocs/ and backend/ and frontend/ are subfolders.
const isPleskDeploy = fs.existsSync(path.join(ROOT, 'backend', 'app.js'));

console.log('\n🚀 MeetSpace Deploy Script');
console.log(`   Mode: ${isPleskDeploy ? 'Plesk (repo cloned into httpdocs/)' : 'Local build'}`);
console.log(`   Root: ${ROOT}\n`);

// ─── Step 1: Install frontend dependencies ────────────────────────────────────
console.log('\n📦 Step 1: Installing frontend dependencies...');
run('npm install', path.join(ROOT, 'frontend'));

// ─── Step 2: Build frontend ───────────────────────────────────────────────────
console.log('\n🔨 Step 2: Building frontend...');

// Create frontend/.env if it doesn't exist (use production URL)
const frontendEnv = path.join(ROOT, 'frontend', '.env');
if (!fs.existsSync(frontendEnv)) {
  fs.writeFileSync(frontendEnv, 'VITE_SOCKET_URL=https://meetspace.swiftcampus.com\n');
  console.log('  ✅ Created frontend/.env with production VITE_SOCKET_URL');
}

run('npm run build', path.join(ROOT, 'frontend'));

// ─── Step 3: Install backend dependencies ────────────────────────────────────
console.log('\n📦 Step 3: Installing backend dependencies...');
run('npm install --omit=dev', path.join(ROOT, 'backend'));

// ─── Step 4: Copy files to httpdocs root (Plesk flat structure) ───────────────
if (isPleskDeploy) {
  console.log('\n📁 Step 4: Copying files to httpdocs root...');

  // Copy backend files to root
  copyFile(path.join(ROOT, 'backend', 'app.js'),       path.join(ROOT, 'app.js'));
  copyFile(path.join(ROOT, 'backend', 'package.json'), path.join(ROOT, 'package.json'));
  copyFile(path.join(ROOT, 'backend', 'web.config'),   path.join(ROOT, 'web.config'));

  // Copy node_modules from backend to root
  console.log('  📦 Copying node_modules (this may take a moment)...');
  copyDir(
    path.join(ROOT, 'backend', 'node_modules'),
    path.join(ROOT, 'node_modules')
  );

  // Copy frontend dist to root/dist
  copyDir(
    path.join(ROOT, 'frontend', 'dist'),
    path.join(ROOT, 'dist')
  );

  // Copy .env if it exists in backend (won't be in git, set manually on server)
  const backendEnv = path.join(ROOT, 'backend', '.env');
  if (fs.existsSync(backendEnv)) {
    copyFile(backendEnv, path.join(ROOT, '.env'));
  } else {
    console.log('  ⚠️  backend/.env not found — make sure .env exists at httpdocs root on server!');
  }

  console.log('\n✅ Deploy complete! Files are ready in httpdocs/');
  console.log('   → Restart the Node.js app in Plesk to apply changes.\n');
} else {
  console.log('\n✅ Build complete! frontend/dist/ is ready.');
  console.log('   → For Plesk deployment, push to GitHub and let Plesk pull.\n');
}
