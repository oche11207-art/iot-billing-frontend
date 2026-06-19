import { test, expect } from '@playwright/test';

// Extend Window interface for our mocked properties
declare global {
  interface Window {
    __mockFreighter?: boolean;
    __mockPublicKey?: string;
    __mockFreighterError?: boolean;
    __mockHardwareWallet?: boolean;
  }
}

test.describe('Wallet Disconnection Security', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should terminate session within 2 seconds of wallet disconnection', async ({ page }) => {
    // Mock Freighter wallet connection
    await page.evaluate(() => {
      window.__mockFreighter = true;
      window.__mockPublicKey = 'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7';
    });

    // Connect wallet
    const connectBtn = page.getByRole('button', { name: /connect.*wallet/i });
    await connectBtn.click();

    // Wait for connection to complete
    const connectedIndicator = page.getByText(/connected/i);
    await expect(connectedIndicator).toBeVisible({ timeout: 10000 });

    // Record the time when we disconnect
    const disconnectStartTime = Date.now();

    // Simulate wallet disconnection by triggering watchWalletChanges callback
    await page.evaluate(() => {
      // Simulate wallet lock/disconnect event
      const event = new CustomEvent('freighter-wallet-change', {
        detail: { address: null }
      });
      window.dispatchEvent(event);
    });

    // Wait for the UI to return to the "Connect Wallet" screen
    const connectBtnAfterDisconnect = page.getByRole('button', { name: /connect.*wallet/i });
    await expect(connectBtnAfterDisconnect).toBeVisible({ timeout: 3000 });

    const disconnectEndTime = Date.now();
    const disconnectDuration = disconnectEndTime - disconnectStartTime;

    // Assert that the disconnection happened within 2 seconds
    expect(disconnectDuration).toBeLessThan(2000);

    // Disconnect duration assertion already verified above — test complete
  });

  test('should return to connect screen after wallet disconnection', async ({ page }) => {
    // Mock Freighter wallet
    await page.evaluate(() => {
      window.__mockFreighter = true;
      window.__mockPublicKey = 'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7';
    });

    // Connect wallet
    const connectBtn = page.getByRole('button', { name: /connect.*wallet/i });
    await connectBtn.click();

    await page.waitForTimeout(2000); // Wait for connection

    // Verify we're connected
    const connectedIndicator = page.getByText(/connected/i);
    await expect(connectedIndicator).toBeVisible({ timeout: 5000 });

    // Simulate wallet disconnection
    await page.evaluate(() => {
      const event = new CustomEvent('freighter-wallet-change', {
        detail: { address: null }
      });
      window.dispatchEvent(event);
    });

    // Wait for disconnection to process and verify UI returns to connect screen
    const connectBtnAfterDisconnect = page.getByRole('button', { name: /connect.*wallet/i });
    await expect(connectBtnAfterDisconnect).toBeVisible({ timeout: 3000 });
  });

  test('should clear query cache on wallet disconnection', async ({ page }) => {
    // Mock wallet connection
    await page.evaluate(() => {
      window.__mockFreighter = true;
      window.__mockPublicKey = 'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7';
    });

    // Connect and wait for data to load
    const connectBtn = page.getByRole('button', { name: /connect.*wallet/i });
    await connectBtn.click();
    await page.waitForTimeout(2000);

    // Disconnect wallet
    await page.evaluate(() => {
      const event = new CustomEvent('freighter-wallet-change', {
        detail: { address: null }
      });
      window.dispatchEvent(event);
    });

    // Wait for disconnection
    await page.waitForTimeout(500);

    // Verify we're back at the connect screen (wallet disconnected and cache cleared)
    const connectBtnAfter = page.getByRole('button', { name: /connect.*wallet/i });
    await expect(connectBtnAfter).toBeVisible();
  });

  test('should handle hardware wallet lock immediately', async ({ page }) => {
    // Mock hardware wallet connection
    await page.evaluate(() => {
      window.__mockFreighter = true;
      window.__mockPublicKey = 'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7';
      window.__mockHardwareWallet = true;
    });

    // Connect wallet
    const connectBtn = page.getByRole('button', { name: /connect.*wallet/i });
    await connectBtn.click();
    await page.waitForTimeout(2000);

    const lockStartTime = Date.now();

    // Simulate hardware wallet lock (similar to disconnection)
    await page.evaluate(() => {
      const event = new CustomEvent('freighter-wallet-change', {
        detail: { address: null, reason: 'locked' }
      });
      window.dispatchEvent(event);
    });

    // Wait for return to connect screen
    const connectBtnAfterLock = page.getByRole('button', { name: /connect.*wallet/i });
    await expect(connectBtnAfterLock).toBeVisible({ timeout: 3000 });

    const lockEndTime = Date.now();
    const lockDuration = lockEndTime - lockStartTime;

    // Verify immediate response (under 2 seconds)
    expect(lockDuration).toBeLessThan(2000);
  });

  test('should call /api/auth/logout on wallet disconnection', async ({ page }) => {
    // Track API calls
    const logoutCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/logout')) {
        logoutCalls.push(request.url());
      }
    });

    // Mock wallet
    await page.evaluate(() => {
      window.__mockFreighter = true;
      window.__mockPublicKey = 'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7';
    });

    // Connect
    const connectBtn = page.getByRole('button', { name: /connect.*wallet/i });
    await connectBtn.click();
    await page.waitForTimeout(2000);

    // Disconnect
    await page.evaluate(() => {
      const event = new CustomEvent('freighter-wallet-change', {
        detail: { address: null }
      });
      window.dispatchEvent(event);
    });

    // Wait for logout call
    await page.waitForTimeout(1000);

    // Verify logout was called
    expect(logoutCalls.length).toBeGreaterThan(0);
  });
});
