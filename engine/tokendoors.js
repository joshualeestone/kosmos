'use strict';
/**
 * The token doors (#529): one row per service, on tokendoor.js. Each row
 * says where a person makes the token, what agents will read it as, and the
 * service's own "who am I" call that proves the token before it is kept.
 *
 * ⚠️ `proven` is true only for a service whose door has checked a REAL
 * token through this code. The others' verify calls come from the
 * services' public API documentation and have not been run against a live
 * account here; a wrong shape fails LOUD (the door says the service did
 * not accept the token) and never silent, so it is honest to ship them,
 * and dishonest to mark them proven. Flip the flag when one is.
 */
const { makeTokenDoor } = require('./tokendoor');

const bearer = (t) => ({ Authorization: 'Bearer ' + t });
const okIf2xx = (status) => (status >= 200 && status < 300 ? { ok: true } : { ok: false });

const SPECS = [
  {
    name: 'Discord', slug: 'discord', envVar: 'DISCORD_BOT_TOKEN',
    where: 'https://discord.com/developers/applications', whereText: 'Discord’s developer applications page',
    hint: 'open your application, then Bot, then Reset Token',
    verify: { url: 'https://discord.com/api/v10/users/@me', headers: (t) => ({ Authorization: 'Bot ' + t, 'User-Agent': 'Kosmos (installkosmos.com, 1.0)' }) },
    verifyUrlEnv: 'AGENT_WORKFORCE_DISCORD_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.username ? { ok: true, who: b.username } : { ok: false }),
    proven: true,
  },
  {
    name: 'Brave Search', slug: 'brave-search', envVar: 'BRAVE_API_KEY',
    where: 'https://api-dashboard.search.brave.com/app/keys', whereText: 'Brave’s API keys page',
    verify: { url: 'https://api.search.brave.com/res/v1/web/search?q=kosmos&count=1', headers: (t) => ({ 'X-Subscription-Token': t, Accept: 'application/json' }) },
    verifyUrlEnv: 'AGENT_WORKFORCE_BRAVE_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Exa', slug: 'exa', envVar: 'EXA_API_KEY',
    where: 'https://dashboard.exa.ai/api-keys', whereText: 'Exa’s API keys page',
    verify: { method: 'POST', url: 'https://api.exa.ai/search', headers: (t) => ({ 'x-api-key': t }), body: { query: 'kosmos', numResults: 1 } },
    verifyUrlEnv: 'AGENT_WORKFORCE_EXA_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Tavily', slug: 'tavily', envVar: 'TAVILY_API_KEY',
    where: 'https://app.tavily.com/home', whereText: 'Tavily’s dashboard',
    verify: { method: 'POST', url: 'https://api.tavily.com/search', headers: bearer, body: { query: 'kosmos', max_results: 1 } },
    verifyUrlEnv: 'AGENT_WORKFORCE_TAVILY_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Serper', slug: 'serper', envVar: 'SERPER_API_KEY',
    where: 'https://serper.dev/api-key', whereText: 'Serper’s API key page',
    verify: { method: 'POST', url: 'https://google.serper.dev/search', headers: (t) => ({ 'X-API-KEY': t }), body: { q: 'kosmos' } },
    verifyUrlEnv: 'AGENT_WORKFORCE_SERPER_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'GitLab', slug: 'gitlab', envVar: 'GITLAB_TOKEN',
    where: 'https://gitlab.com/-/user_settings/personal_access_tokens', whereText: 'GitLab’s personal access tokens page',
    hint: 'with the api scope',
    verify: { url: 'https://gitlab.com/api/v4/user', headers: (t) => ({ 'PRIVATE-TOKEN': t }) },
    verifyUrlEnv: 'AGENT_WORKFORCE_GITLAB_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.username ? { ok: true, who: b.username } : { ok: false }),
  },
  {
    name: 'Fly.io', slug: 'fly', envVar: 'FLY_API_TOKEN',
    where: 'https://fly.io/user/personal_access_tokens', whereText: 'Fly.io’s personal access tokens page',
    verify: { method: 'POST', url: 'https://api.fly.io/graphql', headers: bearer, body: { query: '{ viewer { email } }' } },
    verifyUrlEnv: 'AGENT_WORKFORCE_FLY_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.data && b.data.viewer && b.data.viewer.email ? { ok: true, who: b.data.viewer.email } : { ok: false }),
  },
  {
    name: 'DigitalOcean', slug: 'digitalocean', envVar: 'DIGITALOCEAN_TOKEN',
    where: 'https://cloud.digitalocean.com/account/api/tokens', whereText: 'DigitalOcean’s API tokens page',
    verify: { url: 'https://api.digitalocean.com/v2/account', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_DIGITALOCEAN_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.account ? { ok: true, who: b.account.email || null } : { ok: false }),
  },
  {
    name: 'Hetzner', slug: 'hetzner', envVar: 'HCLOUD_TOKEN',
    where: 'https://console.hetzner.cloud', whereText: 'the Hetzner Cloud console',
    hint: 'in your project: Security, then API tokens, with read and write',
    verify: { url: 'https://api.hetzner.cloud/v1/servers?per_page=1', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_HETZNER_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Netlify', slug: 'netlify', envVar: 'NETLIFY_AUTH_TOKEN',
    where: 'https://app.netlify.com/user/applications#personal-access-tokens', whereText: 'Netlify’s personal access tokens page',
    verify: { url: 'https://api.netlify.com/api/v1/user', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_NETLIFY_VERIFY_URL',
    accept: (s, b) => (s === 200 && b ? { ok: true, who: b.email || b.full_name || null } : { ok: false }),
  },
  {
    name: 'Render', slug: 'render', envVar: 'RENDER_API_KEY',
    where: 'https://dashboard.render.com/u/settings#api-keys', whereText: 'Render’s API keys page',
    verify: { url: 'https://api.render.com/v1/owners?limit=1', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_RENDER_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Notion', slug: 'notion', envVar: 'NOTION_TOKEN',
    where: 'https://www.notion.so/my-integrations', whereText: 'Notion’s integrations page',
    hint: 'make an internal integration and share the pages it may read',
    verify: { url: 'https://api.notion.com/v1/users/me', headers: (t) => ({ Authorization: 'Bearer ' + t, 'Notion-Version': '2022-06-28' }) },
    verifyUrlEnv: 'AGENT_WORKFORCE_NOTION_VERIFY_URL',
    accept: (s, b) => (s === 200 && b ? { ok: true, who: b.name || null } : { ok: false }),
  },
  {
    name: 'Linear', slug: 'linear', envVar: 'LINEAR_API_KEY',
    where: 'https://linear.app/settings/api', whereText: 'Linear’s API settings',
    verify: { method: 'POST', url: 'https://api.linear.app/graphql', headers: (t) => ({ Authorization: t }), body: { query: '{ viewer { email } }' } },
    verifyUrlEnv: 'AGENT_WORKFORCE_LINEAR_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.data && b.data.viewer ? { ok: true, who: b.data.viewer.email || null } : { ok: false }),
  },
  {
    name: 'Airtable', slug: 'airtable', envVar: 'AIRTABLE_API_KEY',
    where: 'https://airtable.com/create/tokens', whereText: 'Airtable’s personal access tokens page',
    hint: 'with the scopes and bases your agents may touch',
    verify: { url: 'https://api.airtable.com/v0/meta/whoami', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_AIRTABLE_VERIFY_URL',
    accept: (s, b) => (s === 200 && b && b.id ? { ok: true, who: b.email || null } : { ok: false }),
  },
  {
    name: 'Neon', slug: 'neon', envVar: 'NEON_API_KEY',
    where: 'https://console.neon.tech/app/settings/api-keys', whereText: 'Neon’s API keys page',
    verify: { url: 'https://console.neon.tech/api/v2/users/me', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_NEON_VERIFY_URL',
    accept: (s, b) => (s === 200 && b ? { ok: true, who: b.email || null } : { ok: false }),
  },
  {
    name: 'Postmark', slug: 'postmark', envVar: 'POSTMARK_SERVER_TOKEN',
    where: 'https://account.postmarkapp.com/servers', whereText: 'Postmark’s servers page',
    hint: 'open the server, then API Tokens',
    verify: { url: 'https://api.postmarkapp.com/server', headers: (t) => ({ 'X-Postmark-Server-Token': t, Accept: 'application/json' }) },
    verifyUrlEnv: 'AGENT_WORKFORCE_POSTMARK_VERIFY_URL',
    accept: (s, b) => (s === 200 && b ? { ok: true, who: b.Name || null } : { ok: false }),
  },
  {
    name: 'SendGrid', slug: 'sendgrid', envVar: 'SENDGRID_API_KEY',
    where: 'https://app.sendgrid.com/settings/api_keys', whereText: 'SendGrid’s API keys page',
    verify: { url: 'https://api.sendgrid.com/v3/user/profile', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_SENDGRID_VERIFY_URL', accept: okIf2xx,
  },
  {
    name: 'Better Stack', slug: 'better-stack', envVar: 'BETTERSTACK_API_TOKEN',
    where: 'https://uptime.betterstack.com/team/api-tokens', whereText: 'Better Stack’s API tokens page',
    verify: { url: 'https://uptime.betterstack.com/api/v2/monitors?per_page=1', headers: bearer },
    verifyUrlEnv: 'AGENT_WORKFORCE_BETTERSTACK_VERIFY_URL', accept: okIf2xx,
  },
];

const DOORS = new Map(SPECS.map((s) => [s.slug, makeTokenDoor(s)]));
const bySlug = (slug) => DOORS.get(slug) || null;
const byName = (name) => { for (const d of DOORS.values()) if (d.spec.name === name) return d; return null; };
/** For the page: name -> route, the honest inventory of what connects. */
const routes = () => Object.fromEntries(SPECS.map((s) => [s.name, '/api/svc/' + s.slug]));

module.exports = { SPECS, DOORS, bySlug, byName, routes };
