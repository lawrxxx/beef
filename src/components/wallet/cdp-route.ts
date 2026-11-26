/**
 * some phones can't reach api.cdp.coinbase.com directly (carrier dns, private relay,
 * content blockers). when that happens, beef sends coinbase's sign-in requests through its
 * own domain instead (/cdp-api, a rewrite in next.config.ts) so the phone only talks to beef.
 *
 * only the sign-in and session endpoints go this way. they carry no wallet signature. requests
 * that do carry one (x-wallet-auth signs the exact host and path) always go straight to
 * coinbase, or the signature would no longer match.
 *
 * the cdp sdk uses axios, which uses XMLHttpRequest in the browser, so the switch happens at
 * XMLHttpRequest.open: direct first, and after the first direct request that gets no response
 * at all, proxied for the rest of the browser session.
 */
const DIRECT = "https://api.cdp.coinbase.com/platform";
const PROXY = "/cdp-api";
const KEY = "beef-cdp-proxy";
const UNSIGNED = /^\/v2\/embedded-wallet-api\/projects\/[^/]+\/(config|auth\/(mfa|init|verify\/.+|refresh|logout|custom\/authenticate))$/;

let proxied = false;
let installed = false;

const unsignedPath = (url: string) => {
  if (!url.startsWith(DIRECT)) return null;
  const path = url.slice(DIRECT.length).split("?")[0];
  return UNSIGNED.test(path) ? url.slice(DIRECT.length) : null;
};

export function switchToCdpProxy() {
  if (proxied) return;
  proxied = true;
  try { sessionStorage.setItem(KEY, "1"); } catch {}
  console.warn("[beef wallet] coinbase unreachable from this device, routing sign-in through beef");
}

export function installCdpRoute() {
  if (installed || typeof window === "undefined" || typeof XMLHttpRequest === "undefined") return;
  installed = true;
  try { proxied = sessionStorage.getItem(KEY) === "1"; } catch {}
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const href = String(url);
    const rel = unsignedPath(href);
    if (rel) {
      if (proxied) return (open as (...a: unknown[]) => void).call(this, method, PROXY + rel, ...rest);
      // no response at all from coinbase: switch to the proxy for the next attempt
      this.addEventListener("error", switchToCdpProxy, { once: true });
      this.addEventListener("timeout", switchToCdpProxy, { once: true });
    }
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}
