#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// test-credentials.js — Generate & display TURN credentials for testing
//
// Usage:
//   node "TURN Server/test-credentials.js"
//   node "TURN Server/test-credentials.js" myusername
//
// This generates the same HMAC-SHA1 credentials that app.js sends to clients.
// Use the output to test your coturn server with:
//   - https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
//   - turnutils_uclient (included in coturn)
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const path   = require('path');

// Load .env from project root
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  // dotenv not installed — read env vars directly
}

const TURN_HOST   = process.env.TURN_HOST   || 'YOUR_SERVER_PUBLIC_IP';
const TURN_PORT   = process.env.TURN_PORT   || '3478';
const TURN_TLS_PORT = process.env.TURN_TLS_PORT && process.env.TURN_TLS_PORT.trim() !== '' ? process.env.TURN_TLS_PORT.trim() : null;
const TURN_SECRET = process.env.TURN_SECRET || 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_STRING';
const TURN_TTL    = parseInt(process.env.TURN_TTL || '86400', 10);

const userId   = process.argv[2] || 'testuser';
const expiry   = Math.floor(Date.now() / 1000) + TURN_TTL;
const username = `${expiry}:${userId}`;
const credential = crypto
  .createHmac('sha1', TURN_SECRET)
  .update(username)
  .digest('base64');

const expiryDate = new Date(expiry * 1000).toISOString();

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║          coturn TURN Credential Test                        ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('📋 Generated Credentials:');
console.log('─────────────────────────────────────────────────────────────');
console.log(`  Username   : ${username}`);
console.log(`  Credential : ${credential}`);
console.log(`  Expires    : ${expiryDate}`);
console.log(`  TTL        : ${TURN_TTL}s (${TURN_TTL / 3600}h)`);
console.log('');

console.log('🌐 ICE Server Config (paste into browser console or trickle-ice tester):');
console.log('─────────────────────────────────────────────────────────────');

const iceServers = [];

if (TURN_HOST !== 'YOUR_SERVER_PUBLIC_IP') {
  iceServers.push(
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username, credential },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username, credential },
    { urls: `stun:${TURN_HOST}:${TURN_PORT}` }
  );
  if (TURN_TLS_PORT) {
    iceServers.push(
      { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=tcp`, username, credential },
      { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=udp`, username, credential }
    );
  }
} else {
  console.log('  ⚠️  TURN_HOST is not configured. Set it in your .env file.');
}

console.log(JSON.stringify(iceServers, null, 2));
console.log('');

console.log('🔧 Test with turnutils_uclient (inside the coturn Docker container):');
console.log('─────────────────────────────────────────────────────────────');
console.log(`  docker exec meetspace-turn turnutils_uclient \\`);
console.log(`    -u "${username}" \\`);
console.log(`    -w "${credential}" \\`);
console.log(`    ${TURN_HOST}`);
console.log('');

console.log('🌍 Test with Trickle ICE web tool:');
console.log('─────────────────────────────────────────────────────────────');
console.log('  1. Open: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/');
console.log(`  2. STUN or TURN URI: turn:${TURN_HOST}:${TURN_PORT}`);
console.log(`  3. TURN username:    ${username}`);
console.log(`  4. TURN password:    ${credential}`);
console.log('  5. Click "Add Server" then "Gather candidates"');
console.log('  6. Look for "relay" type candidates — that confirms TURN is working!\n');

if (TURN_SECRET === 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_STRING') {
  console.log('⚠️  WARNING: You are using the default TURN_SECRET placeholder!');
  console.log('   Generate a real secret and update both .env and turnserver.conf:');
  console.log('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.log('');
}
