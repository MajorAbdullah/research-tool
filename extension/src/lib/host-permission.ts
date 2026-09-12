/**
 * Just-in-time host permission for the user's own configured Sieve server.
 *
 * Why this exists at all: `fetch()` from an extension's background/options
 * context is still subject to normal CORS like any other fetch, UNLESS the
 * target origin is covered by a *granted* host permission — that grant is
 * what makes Chrome treat the extension's requests to that origin as
 * privileged instead of a regular cross-origin page fetch. Declaring the
 * server's origin in the manifest's static `host_permissions` would work,
 * but the server URL is user-configured and unknown at build time — and
 * declaring `<all_urls>` there just to cover "whatever the user types in
 * later" is exactly the kind of over-broad grant CLAUDE.md's least-privilege
 * rule exists to prevent.
 *
 * The fix: `optional_host_permissions` in the manifest (see manifest.json)
 * declares the capability without granting anything at install time, and
 * this module calls `chrome.permissions.request()` for the ONE origin the
 * user actually enters, at the moment they enter it (a real user gesture,
 * from the options page's Save/Test-connection buttons) — the permission
 * prompt Chrome shows is scoped to that single origin, not "all websites."
 */

export async function ensureServerOriginPermission(
  origin: string,
): Promise<{ granted: true } | { granted: false; message: string }> {
  const pattern = `${origin}/*`
  try {
    const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] })
    if (alreadyGranted) return { granted: true }

    const granted = await chrome.permissions.request({ origins: [pattern] })
    if (granted) return { granted: true }
    return {
      granted: false,
      message:
        'Sieve needs permission to contact your server. Try again and allow access when prompted.',
    }
  } catch (err) {
    return {
      granted: false,
      message: err instanceof Error ? err.message : 'Could not request permission for that server.',
    }
  }
}

/** Best-effort cleanup: drop a previously-granted origin when the user points Sieve at a new server. */
export async function releaseServerOriginPermission(origin: string): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [`${origin}/*`] })
  } catch {
    // Non-fatal — an extra lingering grant from a since-abandoned server URL
    // is a minor over-privilege, not a correctness issue. Never let cleanup
    // failure block the (already-succeeded) save of the new server URL.
  }
}
