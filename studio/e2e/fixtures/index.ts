import { test as base } from '@playwright/test'

// Extend this object as you add page object models or shared state.
// Example:
//
//   import { LoginPage } from '../pages/LoginPage'
//
//   type Fixtures = {
//     loginPage: LoginPage
//   }
//
//   export const test = base.extend<Fixtures>({
//     loginPage: async ({ page }, use) => {
//       await use(new LoginPage(page))
//     },
//   })

export const test = base
export { expect } from '@playwright/test'
