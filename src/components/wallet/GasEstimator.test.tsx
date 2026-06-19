import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GasEstimator } from './GasEstimator';
import type { FeeBreakdown } from '@/hooks/useGasEstimate';

vi.mock('@/utils/currencyFormatter', () => ({
  formatCurrency: (val: string | number) =>
    Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 }),
}));

// Helper to flush pending microtasks and let React process state updates
const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('GasEstimator', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ price: 0.12 }),
      }),
    );
  });

  it('shows loading spinner when estimating with no breakdown', async () => {
    await act(async () => {
      render(<GasEstimator feeBreakdown={null} estimating={true} error={null} />);
      await flushAsync();
    });
    expect(screen.getByText('Gas Fee Estimate')).toBeDefined();
    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('renders fee breakdown rows with values', async () => {
    const breakdown: FeeBreakdown = {
      classicFee: '0.0000100',
      minResourceFee: '0.0000500',
      refundableFee: '0.0000200',
      total: '0.0000800',
      isFallback: false,
      timestamp: Date.now(),
    };
    await act(async () => {
      render(<GasEstimator feeBreakdown={breakdown} estimating={false} error={null} />);
      await flushAsync();
    });
    expect(screen.getByText('Inclusion Fee')).toBeDefined();
    expect(screen.getByText('Resource Fee (Read/Write)')).toBeDefined();
    expect(screen.getByText('Rent Refundable Fee')).toBeDefined();
    expect(screen.getByText('Total Estimated Cost')).toBeDefined();
  });

  it('displays fallback warning when isFallback is true', async () => {
    const breakdown: FeeBreakdown = {
      classicFee: '0.0000100',
      minResourceFee: '0.0000500',
      refundableFee: '0.0000200',
      total: '0.0000800',
      isFallback: true,
      timestamp: Date.now(),
    };
    await act(async () => {
      render(<GasEstimator feeBreakdown={breakdown} estimating={false} error={null} />);
      await flushAsync();
    });
    expect(screen.getByText(/Approximate estimate/)).toBeDefined();
  });

  it('shows error when simulation fails and no breakdown', async () => {
    await act(async () => {
      render(<GasEstimator feeBreakdown={null} estimating={false} error={'Budget exceeded'} />);
      await flushAsync();
    });
    expect(screen.getByText(/Simulation failed/)).toBeDefined();
    expect(screen.getByText(/Budget exceeded/)).toBeDefined();
  });

  it('renders --- when no breakdown available and not estimating', async () => {
    await act(async () => {
      render(<GasEstimator feeBreakdown={null} estimating={false} error={null} />);
      await flushAsync();
    });
    const dashes = screen.getAllByText('---');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
