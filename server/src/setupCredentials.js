// Interactive local setup. Run with: npm run setup (from inside server/).
//
// Imports the existing local credential files
// (~/zaphira-amazon-tokens.json, ~/zaphira-amazon-profiles.json), asks for
// the Client Secret (and Client ID, if not already present in the token
// file) via a hidden terminal prompt, and writes server/.env.amazon.local.
//
// This script NEVER prints a secret value to the terminal -- not the
// Client Secret, not the refresh token, not the access token. Confirmations
// only ever show a masked last-4-characters form. Nothing is sent
// anywhere; this only writes a local file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseJsonPreservingIdFields } from './safeJson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.amazon.local');
const tokensPath = path.join(os.homedir(), 'zaphira-amazon-tokens.json');
const profilesPath = path.join(os.homedir(), 'zaphira-amazon-profiles.json');

function maskLast4(value) {
  if (!value) return '(not set)';
  const s = String(value);
  return s.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

// idFields: field names to protect from JSON.parse's silent precision loss
// on large integers (see safeJson.js) -- pass ['profileId'] for the
// profiles file, since Amazon profile IDs can exceed
// Number.MAX_SAFE_INTEGER and a rounded ID would write the WRONG profile
// into .env.amazon.local without any error.
function readJsonIfExists(filePath, idFields = []) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return idFields.length > 0 ? parseJsonPreservingIdFields(text, idFields) : JSON.parse(text);
  } catch {
    console.log(`Could not parse ${filePath} as JSON -- skipping it.`);
    return null;
  }
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

// Character codes for the control keys this hidden prompt needs to
// recognize -- compared by code point rather than embedding literal
// control bytes in the source, so the source stays unambiguous plain text.
const CHAR_CODE = { LF: 10, CR: 13, EOF: 4, ETX: 3, BACKSPACE: 8, DEL: 127 };

// Hand-rolled hidden prompt (no third-party dependency): puts stdin into
// raw mode, echoes nothing back for each keystroke, and resolves on Enter.
function hiddenPrompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    }

    function onData(chunk) {
      const c = chunk.toString();
      const code = c.charCodeAt(0);
      if (code === CHAR_CODE.LF || code === CHAR_CODE.CR || code === CHAR_CODE.EOF) {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
      } else if (code === CHAR_CODE.ETX) {
        cleanup();
        process.stdout.write('\n');
        process.exit(1);
      } else if (code === CHAR_CODE.BACKSPACE || code === CHAR_CODE.DEL) {
        value = value.slice(0, -1);
      } else {
        value += c;
      }
    }

    stdin.on('data', onData);
  });
}

function pickUsProfile(profilesData) {
  const list = Array.isArray(profilesData) ? profilesData : Array.isArray(profilesData?.profiles) ? profilesData.profiles : null;
  if (!list) return { candidates: [], profiles: [] };
  const profiles = list;
  const candidates = profiles.filter((p) => p.countryCode === 'US');
  return { candidates, profiles };
}

async function main() {
  console.log('Zaphira PPC Control -- Amazon Ads API local setup');
  console.log('This only writes a local file. Nothing is sent anywhere.\n');

  if (fs.existsSync(envPath)) {
    const overwrite = await prompt(`${envPath} already exists. Overwrite it? (y/N) `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled -- existing file left unchanged.');
      process.exit(0);
    }
  }

  // --- Client ID / Client Secret ---
  const tokensData = readJsonIfExists(tokensPath);
  if (tokensData) console.log(`Found ${tokensPath}`);
  else console.log(`Did not find ${tokensPath} -- you can still enter values manually below, or run this again once that file exists.`);

  let clientId = tokensData?.client_id || tokensData?.clientId || '';
  if (!clientId) {
    clientId = await prompt('LWA Client ID (from your Amazon Ads API app registration): ');
  } else {
    console.log(`Using Client ID from token file: ${clientId}`);
  }

  const clientSecret = await hiddenPrompt('LWA Client Secret (hidden, not echoed): ');
  if (!clientSecret) {
    console.log('No Client Secret entered -- aborting so nothing incomplete gets written.');
    process.exit(1);
  }

  const refreshToken = tokensData?.refresh_token || tokensData?.refreshToken || '';
  if (!refreshToken) {
    console.log(`No refresh_token field found in ${tokensPath}. Setup cannot continue without it.`);
    process.exit(1);
  }
  console.log(`Refresh token found (${maskLast4(refreshToken)}).`);

  // --- US profile ---
  const profilesData = readJsonIfExists(profilesPath, ['profileId']);
  let profileId = '';
  if (profilesData) {
    const { candidates, profiles } = pickUsProfile(profilesData);
    if (candidates.length === 1) {
      profileId = String(candidates[0].profileId);
      console.log(`Found one US profile: ${profileId} (${candidates[0].accountInfo?.name ?? 'unnamed account'})`);
    } else if (candidates.length > 1) {
      console.log('Multiple US profiles found:');
      candidates.forEach((p, i) => console.log(`  ${i + 1}. ${p.profileId} -- ${p.accountInfo?.name ?? 'unnamed account'}`));
      const choice = await prompt('Enter the number of the profile to use: ');
      const idx = Number(choice) - 1;
      profileId = candidates[idx] ? String(candidates[idx].profileId) : '';
    } else if (profiles.length > 0) {
      console.log('No US-marketplace profile found in the profiles file. Available profiles:');
      profiles.forEach((p) => console.log(`  ${p.profileId} -- countryCode ${p.countryCode}`));
    }
  } else {
    console.log(`Did not find ${profilesPath}.`);
  }
  if (!profileId) {
    profileId = await prompt('US Amazon Ads Profile ID: ');
  }
  if (!profileId) {
    console.log('No profile ID provided -- aborting so nothing incomplete gets written.');
    process.exit(1);
  }

  const contents = [
    `AMAZON_ADS_CLIENT_ID=${clientId}`,
    `AMAZON_ADS_CLIENT_SECRET=${clientSecret}`,
    `AMAZON_ADS_REFRESH_TOKEN=${refreshToken}`,
    `AMAZON_ADS_PROFILE_ID=${profileId}`,
    'AMAZON_ADS_REGION=NA',
    'AMAZON_BACKEND_PORT=4001',
    '',
  ].join('\n');

  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  console.log(`\nSaved ${envPath} (file permissions restricted to your user).`);
  console.log(`  Client ID:      ${clientId}`);
  console.log(`  Client Secret:  ${maskLast4(clientSecret)}`);
  console.log(`  Refresh token:  ${maskLast4(refreshToken)}`);
  console.log(`  Profile ID:     ${profileId}`);
  console.log('\nNext steps:');
  console.log('  1. npm start                (starts the local backend on http://127.0.0.1:4001)');
  console.log('  2. Open the app -> Settings -> Amazon Ads API -> Test Connection');
}

main().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
