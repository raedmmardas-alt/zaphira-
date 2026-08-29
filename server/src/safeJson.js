// Amazon Ads API IDs (profileId, campaignId, adGroupId, keywordId, ...)
// are frequently 17-19 digit integers, which exceeds
// Number.MAX_SAFE_INTEGER (9007199254740991, 16 digits). Standard
// JSON.parse silently rounds such numbers to the nearest representable
// double, which would corrupt an exact-match comparison against a
// configured ID (e.g. AMAZON_ADS_PROFILE_ID) without ever throwing an
// error -- a wrong-but-plausible-looking profile could otherwise be
// "matched" by a rounded ID. This quotes digit sequences for the given
// field names BEFORE parsing, so they always come through as exact
// strings instead of possibly-rounded numbers.
export function parseJsonPreservingIdFields(text, fieldNames) {
  let safeText = text;
  for (const field of fieldNames) {
    const pattern = new RegExp(`"${field}"\\s*:\\s*(\\d+)`, 'g');
    safeText = safeText.replace(pattern, `"${field}":"$1"`);
  }
  return JSON.parse(safeText);
}
