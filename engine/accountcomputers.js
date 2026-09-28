'use strict';

/* #4356 slice 2: the account's computers, read with this Mac's key. The
   person's long-lived web session never enters the board. The only browser
   credential used when opening a row is minted later by signin.html's
   existing ?open=<address> path. */
const ROUTE = '/v1/mac/account-computers';

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function cleanAddress(value) {
  const address = cleanText(value, 253);
  if (!address || address !== address.toLowerCase()) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/.test(address)) return null;
  if (address.split('.').some((part) => part.endsWith('-'))) return null;
  return address;
}

function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.computers)) return null;
  const seen = new Set();
  const computers = [];
  for (const raw of data.computers) {
    if (!raw || typeof raw !== 'object') return null;
    const address = cleanAddress(raw.address);
    const name = cleanText(raw.name, 80);
    if (!address || !name || typeof raw.online !== 'boolean' || typeof raw.this_computer !== 'boolean') return null;
    if (seen.has(address)) return null;
    seen.add(address);
    computers.push({ address, name, online: raw.online, thisComputer: raw.this_computer });
  }
  if (computers.filter((row) => row.thisComputer).length !== 1) return null;
  computers.sort((a, b) => Number(b.thisComputer) - Number(a.thisComputer) || a.name.localeCompare(b.name));
  return computers;
}

async function list(macRequest) {
  let answer;
  try { answer = await macRequest('GET', ROUTE, {}); }
  catch { return { ok: false, computers: [] }; }
  if (!answer || answer.ok !== true) return { ok: false, computers: [] };
  const computers = normalize(answer.data);
  return computers ? { ok: true, computers } : { ok: false, computers: [] };
}

function openIntent(address, coordinator) {
  const clean = cleanAddress(address);
  if (!clean) return null;
  let url;
  try { url = new URL('/signin', coordinator); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  url.searchParams.set('open', clean);
  return url.toString();
}

module.exports = { ROUTE, cleanAddress, normalize, list, openIntent };
