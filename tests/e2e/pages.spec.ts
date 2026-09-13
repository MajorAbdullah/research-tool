import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

/**
 * Every page, signed in, at desktop and phone width.
 *
 * Deliberately uses a FRESH browser context per run and logs in through the real credentials
 * form, so nothing here depends on a session left behind by some other tool. Credentials come
 * from the environment and are never logged.
 *
 * Screenshots land in screenshots/ (gitignored) so a run can be eyeballed afterwards.
 *
 * NOTE: settings-connect-extension.png captures the page AFTER clicking "Reveal token", so that
 * file contains a live EXTENSION_TOKEN. screenshots/ is gitignored for exactly this reason —
 * don't paste that one into an issue or a chat.
 *
 * COST: the chat tests spend ~1 free-tier OpenRouter request per run (the cache test spends
 * none, by definition). That is why this suite is not part of `pnpm test` and does not run in
 * CI by default.
 */

/** Reads the live DB directly — the only way to prove a request was or wasn't actually spent. */
function llmCallCount(): number {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const db = new Database(process.env.SQLITE_PATH ?? './data/sieve.db', { readonly: true })
  try {
    return (db.prepare('select count(*) c from llm_calls').get() as { c: number }).c
  } finally {
    db.close()
  }
}

const SHOTS = 'screenshots'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

async function signIn(page: Page) {
  const email = process.env.SEED_USER_EMAIL
  const password = process.env.SEED_USER_PASSWORD
  if (!email || !password) {
    throw new Error('SEED_USER_EMAIL / SEED_USER_PASSWORD must be set — run with --env-file=.env')
  }
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

/** The page must not scroll sideways — a hard requirement at phone width. */
async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow, `${label}: horizontal scroll`).toBe(false)
}

test.describe('signed out', () => {
  test('protected pages send you to login', async ({ page }) => {
    for (const path of ['/settings', '/import']) {
      const res = await page.goto(path)
      expect(res?.status(), `${path} status`).toBeLessThan(400)
      await expect(page, `${path} should land on login`).toHaveURL(/\/login/)
    }
  })

  test('root redirects into the app', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/(library|login)/)
  })
})

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  const PAGES = [
    { path: '/library', name: 'library', heading: 'Library' },
    { path: '/board', name: 'board', heading: /Inbox/ },
    { path: '/chat', name: 'chat', heading: 'Ask your library' },
    { path: '/import', name: 'import', heading: 'Import from WhatsApp' },
    { path: '/settings', name: 'settings', heading: 'Settings' },
  ] as const

  for (const { path, name, heading } of PAGES) {
    test(`${path} renders at desktop and phone width`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      await page.goto(path)
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 15_000 })
      await expectNoHorizontalScroll(page, `${name} desktop`)
      await page.screenshot({ path: `${SHOTS}/${name}-desktop.png` })

      // Exactly ONE nav landmark should ever be exposed. A display:none element is excluded
      // from the accessibility tree, so this also proves the mobile bar is genuinely gone at
      // desktop rather than merely stacked behind the sidebar — which is the bug that made the
      // bottom bar overlap the sidebar at every width.
      const navs = page.getByRole('navigation', { name: 'Primary' })
      await expect(navs).toHaveCount(1)
      // The sidebar carries the wordmark; the bottom bar does not.
      await expect(navs.getByText('Sieve', { exact: true })).toBeVisible()

      await page.setViewportSize(PHONE)
      await expectNoHorizontalScroll(page, `${name} phone`)
      await expect(navs).toHaveCount(1)
      await expect(navs.getByText('Sieve', { exact: true })).toHaveCount(0)
      await page.screenshot({ path: `${SHOTS}/${name}-phone.png` })
    })
  }

  test('library shows real saved items with their extraction tier', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto('/library')
    await expect(page.getByText('vllm-project/vllm')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Attention Is All You Need')).toBeVisible()
    // The YouTube item degraded to `partial` because no extension was involved — that must be
    // visible, not silent.
    await expect(page.getByText(/Partial extraction/i).first()).toBeVisible()
  })

  test('board lays out all five status columns', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto('/board')
    // Target the column HEADINGS, not bare text: each card carries a status <select> whose
    // <option> labels are the same strings, and those live in a collapsed dropdown.
    for (const col of ['Inbox', 'To Test', 'Testing', 'Tested', 'Archived / Dropped']) {
      await expect(
        page
          .locator('h2, h3')
          .filter({ hasText: new RegExp(`^${col}$`) })
          .first(),
      ).toBeVisible({ timeout: 15_000 })
    }
  })

  test('settings pairing: tabs switch and the token reveals on demand', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto('/settings')

    await expect(page.getByRole('heading', { name: 'Connect your devices' })).toBeVisible()

    // Click the tab explicitly rather than assuming which one is open: the component defaults to
    // the visitor's own platform, so at phone width it opens on Phone. That is the intended
    // behaviour — an earlier version of this test failed on mobile for exactly that reason, which
    // was the feature working, not a bug.
    await page.getByRole('tab', { name: 'Browser' }).click()
    await expect(page.getByText('Load unpacked')).toBeVisible()

    // The real token must NOT be in the initial HTML — only a masked form.
    const html = await page.content()
    expect(html).not.toMatch(/[a-f0-9]{64}/)

    await page.getByRole('button', { name: 'Reveal token' }).click()
    await expect(page.getByText(/^[a-f0-9]{64}$/)).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `${SHOTS}/settings-connect-extension.png` })

    await page.getByRole('tab', { name: 'Phone' }).click()
    await expect(page.getByText(/Add to Home screen/)).toBeVisible()
    await expect(page.getByText(/Share/).first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/settings-connect-phone.png` })
  })

  test('chat generates a real, cited answer from the library', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize(DESKTOP)
    await page.goto('/chat')

    const citationLinks = page.locator('a[href^="/items/"]')
    const chipsBefore = await citationLinks.count()
    const callsBefore = llmCallCount()

    // A UNIQUE question every run. Asking a repeat would be served from the response cache in
    // ~1s with zero model calls — which is the cache working correctly, but it would mean this
    // test proved nothing about generation. An earlier version of this test did exactly that.
    const nonce = Date.now().toString(36)
    await page
      .getByPlaceholder(/Ask about anything/i)
      .fill(`What did I save about attention mechanisms? (run ${nonce})`)
    await page.keyboard.press('Enter')

    await expect
      .poll(async () => citationLinks.count(), {
        timeout: 150_000,
        message: 'waiting for a newly generated answer to add citation chips',
      })
      .toBeGreaterThan(chipsBefore)

    await expect(
      citationLinks.filter({ hasText: 'Attention Is All You Need' }).first(),
    ).toBeVisible()

    // Prove it actually reached a model rather than being served from cache.
    expect(llmCallCount(), 'a unique question must spend a request').toBeGreaterThan(callsBefore)

    await page.screenshot({ path: `${SHOTS}/chat-answer.png`, fullPage: true })
  })

  test('repeating a question is served from cache and costs nothing', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize(DESKTOP)
    await page.goto('/chat')

    const question = `Cache probe ${Date.now().toString(36)}: what did I save about vLLM?`
    const ask = async () => {
      await page.getByPlaceholder(/Ask about anything/i).fill(question)
      await page.keyboard.press('Enter')
    }

    const before = llmCallCount()
    await ask()
    await expect.poll(() => llmCallCount(), { timeout: 150_000 }).toBeGreaterThan(before)
    const afterFirst = llmCallCount()

    await page.reload()
    await ask()
    // Give a real call time to appear if the cache were missing.
    await page.waitForTimeout(8_000)
    expect(llmCallCount(), 'the repeat must not spend a second request').toBe(afterFirst)
  })
})
