// Same mechanism cmd-drive uses to make its public share links reachable
// off-tailnet under Hostess: the platform (not this app) owns the exposure
// decision and, when the operator turns publicGateway on, hands the current
// tunnel URL back via a read-only bind-mounted file. If that file is absent
// (not running under Hostess, or the gateway isn't enabled) share links just
// fall back to whatever origin the owner is currently viewing the app from.
import { readFileSync } from 'fs'

const GATEWAY_URL_FILE = '/run/hostess-gateway/url'

export function buildGatewayOrigin() {
  try { return readFileSync(GATEWAY_URL_FILE, 'utf8').trim() || null } catch { return null }
}

export function buildShareUrl(path) {
  const origin = buildGatewayOrigin()
  return origin ? `${origin}${path}` : null
}
