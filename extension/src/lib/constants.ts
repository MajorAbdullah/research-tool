/**
 * docs/API.md §1.7: "The extension itself caps its captured html/transcript
 * payload at 1 MB with graceful truncation (P4.2.5) — the server enforces
 * its own, slightly larger hard cap independently." This is OUR cap, kept
 * comfortably under the server's 2 MB hard limit on the whole request body.
 */
export const PAYLOAD_CAP_BYTES = 1_000_000

/** Bound on how long we wait for the content script to reply after injection (ms). */
export const CONTENT_SCRIPT_TIMEOUT_MS = 15_000

/** How long a success/failure badge stays up before reverting to blank (ms). */
export const BADGE_CLEAR_DELAY_MS = 4_000
