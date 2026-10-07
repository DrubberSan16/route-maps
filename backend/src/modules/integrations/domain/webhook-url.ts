import { BlockList, isIP, isIPv4 } from 'node:net';

export interface WebhookUrlPolicy {
  /** http:// URLs (development, internal receivers). Production webhooks use https://. */
  allowInsecure: boolean;
  /** Private, loopback and link-local addresses (receivers inside the same network). */
  allowPrivateNetworks: boolean;
}

export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** Addresses that are not on the public Internet (RFC 6890 special-purpose ranges). */
const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

/** IPv4 address embedded in an IPv6 one (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::, 6to4 2002::). */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(lower);
  const words = hex ?? sixToFour;
  if (!words) return null;
  const high = Number.parseInt(words[1], 16);
  const low = Number.parseInt(words[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Whether an IP address (v4 or v6) is a public Internet address. */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return !nonPublic.check(address, 'ipv4');
  if (isIP(address) !== 6) return false;
  const v4 = embeddedIpv4(address);
  if (v4) return isPublicAddress(v4);
  return !nonPublic.check(address, 'ipv6');
}

/**
 * Checks a webhook URL before it is stored and again before each delivery. Host names are
 * resolved only when delivering (the API has no access to the Internet); the worker then refuses
 * names that resolve to a non-public address, unless private networks are allowed.
 */
export function checkWebhookUrl(
  raw: string,
  policy: WebhookUrlPolicy,
): { url: URL; error?: undefined } | { url?: undefined; error: string } {
  if (raw.length > MAX_WEBHOOK_URL_LENGTH) {
    return { error: `The URL must be at most ${MAX_WEBHOOK_URL_LENGTH} characters long` };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'The URL is not valid' };
  }
  if (url.protocol !== 'https:' && !(policy.allowInsecure && url.protocol === 'http:')) {
    return {
      error: policy.allowInsecure ? 'The URL must use https or http' : 'The URL must use https',
    };
  }
  if (url.username || url.password) return { error: 'The URL must not contain credentials' };
  if (url.hash) return { error: 'The URL must not contain a fragment (#)' };
  if (!policy.allowPrivateNetworks) {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(host)) {
      if (!isPublicAddress(host)) return { error: 'The URL must point to a public address' };
    } else if (
      !host.includes('.') ||
      host === 'localhost' ||
      /\.(localhost|local|internal|lan|home|corp|invalid|test|example)$/.test(host)
    ) {
      return { error: 'The URL must point to a public host name' };
    }
  }
  return { url };
}
