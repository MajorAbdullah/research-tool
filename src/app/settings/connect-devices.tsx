'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Download, Eye, Laptop, Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Pairing instructions for the two capture surfaces.
 *
 * This is not decoration — the browser extension is the *extraction engine* (ADR 0006), not a
 * convenience. The server runs on a datacenter IP that YouTube, Instagram, X and Cloudflare all
 * block; the extension runs on the user's residential IP, already signed in. Without it, those
 * sources degrade to `metadata_only`. So the instructions lead with why, not just how.
 *
 * The tab defaults to whichever platform the visitor is actually on, because showing Android
 * steps to someone on a laptop is noise.
 */

type Platform = 'desktop' | 'android' | 'ios'

/**
 * Read through useSyncExternalStore rather than syncing into state from an effect: the platform
 * is external, immutable data, so an effect would cause a render-then-correct cascade for a value
 * that never changes. `subscribe` is a no-op for exactly that reason, and the server snapshot is
 * 'desktop' so SSR and first paint agree.
 */
const subscribePlatform = () => () => {}

function getPlatformSnapshot(): Platform {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'desktop'
}

const getPlatformServerSnapshot = (): Platform => 'desktop'

function CopyField({
  label,
  value,
  mono = true,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }, [value])

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-2 text-xs',
            mono && 'font-mono',
          )}
        >
          {value}
        </code>
        <Button variant="outline" size="icon" className="size-11 shrink-0" onClick={copy}>
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          <span className="sr-only">{copied ? 'Copied' : `Copy ${label}`}</span>
        </Button>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
        {n}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

export function ConnectDevices({ appUrl, hasToken }: { appUrl: string; hasToken: boolean }) {
  const platform = useSyncExternalStore(
    subscribePlatform,
    getPlatformSnapshot,
    getPlatformServerSnapshot,
  )
  // Derived, not stored: the default follows the detected platform until the user picks a tab,
  // so there is no second copy of state to keep in sync.
  const [chosenTab, setChosenTab] = useState<'extension' | 'phone' | null>(null)
  const tab = chosenTab ?? (platform === 'desktop' ? 'extension' : 'phone')
  const setTab = setChosenTab

  const [token, setToken] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)

  const reveal = useCallback(() => {
    setRevealing(true)
    setTokenError(null)
    void fetch('/api/v1/settings/extension-token')
      .then(async (r) => {
        const body: unknown = await r.json()
        if (!r.ok) {
          const env = body as { error?: { message?: string } }
          setTokenError(env.error?.message ?? 'Could not read the token.')
          return
        }
        setToken((body as { token: string }).token)
      })
      .finally(() => setRevealing(false))
  }, [])

  return (
    <section id="connect" className="scroll-mt-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Connect your devices</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Two ways to send links in. Set up both — they cover different jobs.
      </p>

      <div className="mt-3 flex gap-1 rounded-md bg-muted p-1" role="tablist">
        {(
          [
            ['extension', 'Browser', Laptop],
            ['phone', 'Phone', Smartphone],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === 'extension' ? (
        <div className="mt-4">
          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">
              Install this even if you mostly browse on your phone.
            </strong>{' '}
            Your server has a datacenter IP, and YouTube, Instagram, X and Cloudflare-protected
            sites block it. The extension runs in your own browser, on your own connection, already
            signed in — it is the only way to get full video transcripts and paywalled article text.
            Without it those items save as <span className="text-warning">metadata only</span>.
          </p>

          <ol className="mt-4 space-y-3 text-sm text-foreground">
            <Step n={1}>
              Download and unzip it.
              <div className="mt-2">
                <a
                  href="/api/v1/extension/download"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Download className="size-4" aria-hidden />
                  Download sieve-extension.zip
                </a>
              </div>
              <span className="mt-2 block text-xs text-muted-foreground">
                Unzip it somewhere you will keep — Chrome loads the extension from that folder and
                reads it again on every browser restart, so deleting the folder uninstalls it.
              </span>
            </Step>
            <Step n={2}>
              Open{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                chrome://extensions
              </code>{' '}
              in Chrome, Arc or Edge. (Chrome blocks links to that page, so type or paste it into
              the address bar.)
            </Step>
            <Step n={3}>
              Turn on <strong className="font-medium">Developer mode</strong> — top-right toggle.
            </Step>
            <Step n={4}>
              Click <strong className="font-medium">Load unpacked</strong> and select the folder you
              unzipped.
              <span className="mt-1 block text-xs text-muted-foreground">
                Select the <em>folder</em>, not the .zip — Chrome cannot install an archive
                directly.
              </span>
            </Step>
            <Step n={5}>
              Open the extension&rsquo;s <strong className="font-medium">Options</strong> (puzzle
              icon → Sieve → ⋮ → Options) and paste these two values:
              <CopyField label="Server URL" value={appUrl} />
              {token ? (
                <CopyField label="Extension token" value={token} />
              ) : (
                <div className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground">Extension token</p>
                  <Button
                    variant="outline"
                    className="mt-1 min-h-11"
                    onClick={reveal}
                    disabled={revealing || !hasToken}
                  >
                    <Eye className="mr-2 size-4" aria-hidden />
                    {revealing ? 'Reading…' : hasToken ? 'Reveal token' : 'Not set in .env'}
                  </Button>
                  {tokenError ? (
                    <p className="mt-1 text-xs text-destructive">{tokenError}</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Hidden until you ask, so it isn&rsquo;t sitting on screen.
                    </p>
                  )}
                </div>
              )}
            </Step>
            <Step n={6}>
              Hit <strong className="font-medium">Test connection</strong>. Then save any page with
              the toolbar button or{' '}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[11px]">
                ⌘⇧S
              </kbd>{' '}
              /{' '}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[11px]">
                Ctrl⇧S
              </kbd>
              .
            </Step>
          </ol>
        </div>
      ) : (
        <div className="mt-4">
          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            There is no app to install from a store. Sieve installs as a web app, and once it is on
            your home screen{' '}
            <strong className="font-medium text-foreground">
              it appears in Android&rsquo;s normal Share menu
            </strong>{' '}
            — so you can share straight from YouTube, Instagram, X or Chrome without opening Sieve.
          </p>

          {platform === 'ios' ? (
            <p className="mt-3 rounded-md bg-warning/10 p-3 text-xs text-warning-foreground">
              You&rsquo;re on iOS. Safari can install Sieve to your home screen, but Apple does not
              support Web Share Target, so Sieve will not appear in the iOS share sheet. Use the
              paste box or the browser extension instead.
            </p>
          ) : null}

          <ol className="mt-4 space-y-3 text-sm text-foreground">
            <Step n={1}>
              Open this address in <strong className="font-medium">Chrome on your phone</strong>:
              <CopyField label="Address" value={appUrl} mono={false} />
              {appUrl.includes('localhost') || appUrl.includes('127.0.0.1') ? (
                <span className="mt-1 block text-xs text-warning">
                  That address only works on this computer. Deploy Sieve, or use your
                  machine&rsquo;s LAN address, before setting up your phone.
                </span>
              ) : null}
            </Step>
            <Step n={2}>Sign in.</Step>
            <Step n={3}>
              Open Chrome&rsquo;s <strong className="font-medium">⋮ menu</strong> and choose{' '}
              <strong className="font-medium">Add to Home screen</strong> or{' '}
              <strong className="font-medium">Install app</strong>.
            </Step>
            <Step n={4}>
              That&rsquo;s it. Now in any app, tap{' '}
              <strong className="font-medium">Share → Sieve</strong>. The link is queued instantly
              and processed in the background — you can close it straight away.
            </Step>
          </ol>

          <p className="mt-4 text-xs text-muted-foreground">
            Instagram and a few other apps put the link inside the shared <em>text</em> rather than
            the URL field. Sieve pulls the link out of either, and keeps the rest as the
            item&rsquo;s note.
          </p>
        </div>
      )}
    </section>
  )
}
