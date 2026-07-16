import { test, expect } from './fixtures'

// Seed auth state so InsideSalesGuard passes without a real login flow.
const AUTH_USER = {
  id: 'u9',
  email: 'carlos.hernandez@juniperlandscaping.com',
  name: 'Carlos Hernandez',
  role: 'inside_sales',
  branch_id: 'b1',
}

// A minimal Graph calendar event returned by GET /api/calendar/events.
const EXISTING_EVENT = {
  id: 'existing-evt-1',
  subject: 'Existing site visit',
  start: { dateTime: '2026-07-14T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-07-14T15:00:00.0000000', timeZone: 'UTC' },
  attendees: [],
  isOrganizer: true,
  showAs: 'busy',
  isCancelled: false,
  webLink: 'https://outlook.office.com/calendar/item/existing-evt-1',
}

// The event that POST /api/calendar/events returns after create.
const CREATED_EVENT = {
  id: 'new-evt-1',
  subject: 'Smoke test meeting',
  start: { dateTime: '2026-07-15T16:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-07-15T17:00:00.0000000', timeZone: 'UTC' },
  attendees: [],
  isOrganizer: true,
  showAs: 'busy',
  isCancelled: false,
  webLink: 'https://outlook.office.com/calendar/item/new-evt-1',
}

test.describe('Calendar smoke flow', () => {
  test.beforeEach(async ({ page }) => {
    // Seed Zustand persisted auth into localStorage before the app boots.
    await page.addInitScript((user) => {
      localStorage.setItem(
        'studio-auth',
        JSON.stringify({ state: { user }, version: 0 }),
      )
    }, AUTH_USER)

    // Intercept calendar API calls.
    let events = [EXISTING_EVENT]

    await page.route('**/api/calendar/events', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: events })
      } else if (route.request().method() === 'POST') {
        events = [...events, CREATED_EVENT]
        await route.fulfill({ status: 201, json: CREATED_EVENT })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/calendar/events/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ json: CREATED_EVENT })
      } else if (route.request().method() === 'DELETE') {
        events = events.filter((e) => !route.request().url().includes(e.id))
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.continue()
      }
    })

    // Keep all other API calls alive (sidebar nav, user profile, etc.).
    await page.route('**/api/**', (route) => route.continue())
  })

  test('opens the calendar page and shows the view toggle', async ({ page }) => {
    await page.goto('/inside-sales/calendar')
    await expect(page.getByRole('tab', { name: /week/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /3-day/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^day$/i })).toBeVisible()
  })

  test('switches between Week / 3-day / Day views', async ({ page }) => {
    await page.goto('/inside-sales/calendar')

    // Week is default — its tab should be active.
    const weekTab = page.getByRole('tab', { name: /week/i })
    await expect(weekTab).toHaveAttribute('data-state', 'active')

    // Switch to 3-day.
    await page.getByRole('tab', { name: /3-day/i }).click()
    await expect(page.getByRole('tab', { name: /3-day/i })).toHaveAttribute('data-state', 'active')

    // Switch to Day.
    await page.getByRole('tab', { name: /^day$/i }).click()
    await expect(page.getByRole('tab', { name: /^day$/i })).toHaveAttribute('data-state', 'active')
  })

  test('shows the timezone label in the header', async ({ page }) => {
    await page.goto('/inside-sales/calendar')
    await expect(page.getByText(/times shown in/i)).toBeVisible()
  })

  test('Calendar nav entry is visible in the sidebar', async ({ page }) => {
    await page.goto('/inside-sales/calendar')
    await expect(page.getByRole('link', { name: /calendar/i })).toBeVisible()
  })

  test('creates an event and it appears on the grid', async ({ page }) => {
    await page.goto('/inside-sales/calendar')

    // Click the "New event" or equivalent create button (CalendarPage renders one).
    // Fall back to any button that opens the dialog if the label varies.
    const createBtn = page.getByRole('button', { name: /new event|add event|create/i }).first()
    await createBtn.click()

    // EventFormDialog should be open.
    await expect(page.getByRole('dialog')).toBeVisible()

    // Fill in the subject.
    await page.getByLabel(/subject/i).fill('Smoke test meeting')

    // Submit.
    await page.getByRole('button', { name: /schedule|create|save/i }).last().click()

    // Dialog should close.
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // The created event subject should appear on the grid (mocked GET now includes it).
    await expect(page.getByText('Smoke test meeting')).toBeVisible()
  })

  test('deletes an event via the detail popover', async ({ page }) => {
    await page.goto('/inside-sales/calendar')

    // Wait for the existing event to render then click it.
    const eventEl = page.getByText('Existing site visit')
    await expect(eventEl).toBeVisible()
    await eventEl.click()

    // EventDetailPopover should open showing the subject.
    await expect(page.getByRole('dialog').or(page.locator('[data-radix-popper-content-wrapper]'))).toBeVisible()

    // Click Delete (only shown for isOrganizer events).
    await page.getByRole('button', { name: /delete/i }).click()

    // Confirm dialog appears.
    await expect(page.getByText(/confirm|are you sure/i)).toBeVisible()
    await page.getByRole('button', { name: /confirm|yes|delete/i }).last().click()

    // Event should disappear.
    await expect(page.getByText('Existing site visit')).not.toBeVisible()
  })
})
