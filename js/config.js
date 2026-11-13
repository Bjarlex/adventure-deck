// The crew server (Cloudflare Worker). Phones use it unless Settings → Advanced says otherwise,
// so friends who join with an invite code never need to type it. Not a secret: every request
// still needs a member pass or the admin key.
export const DEFAULT_SERVER = 'https://adventure-deck.bjarkeapihl.workers.dev';
