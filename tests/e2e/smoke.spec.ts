import { test, expect } from '@playwright/test'

/**
 * Deliberately thin. Per CLAUDE.md → QA, e2e covers only critical journeys; the
 * pyramid must not invert into an ice-cream cone. Deep behaviour belongs in unit
 * and integration tests, which run in milliseconds.
 */

test('health endpoint reports database status', async ({ request }) => {
  const res = await request.get('/api/v1/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('db')
  // Status is driven ONLY by db — a spent LLM budget or low disk must still be 200,
  // because a restart fixes neither and a spent budget is meant to degrade gracefully.
  expect(body.db).toBe('ok')
})

test('unauthenticated request is redirected to login', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBeLessThan(400)
  await expect(page).toHaveURL(/\/login/)
})

test('capture rejects a request with no bearer token', async ({ request }) => {
  const res = await request.post('/api/v1/capture', {
    data: { url: 'https://github.com/vllm-project/vllm', surface: 'web' },
  })
  expect(res.status()).toBe(401)
})

test('component gallery renders in both themes without horizontal scroll', async ({ page }) => {
  await page.goto('/gallery')
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow, `horizontal scroll in ${theme}`).toBe(false)
  }
})
