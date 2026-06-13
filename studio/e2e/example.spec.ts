import { test, expect } from '@playwright/test'

test.describe('App shell', () => {
  test('root redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    // The RequireAuth guard redirects unauthenticated visitors to /login.
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders the sign-in heading', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading')).toBeVisible()
  })
})
