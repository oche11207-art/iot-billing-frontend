'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  WatchWalletChanges,
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
} from '@stellar/freighter-api';
import type { WalletMetrics, AssetBalance } from '@/types';
import { cacheDelete } from '@/services/indexedDbCache';

// E2E test mock helpers — only active when window.__mockFreighter is set
interface MockWindow extends Window {
  __mockFreighter?: boolean;
  __mockPublicKey?: string;
  __mockFreighterError?: boolean;
  __mockHardwareWallet?: boolean;
}

function isMockMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as MockWindow).__mockFreighter === true;
}

function getMockPublicKey(): string {
  return (window as MockWindow).__mockPublicKey ?? 'GMOCKPUBLICKEY123456789012345678901234567890';
}

function shouldMockError(): boolean {
  return (window as MockWindow).__mockFreighterError === true;
}

interface WalletContextValue {
  metrics: WalletMetrics | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalances: (publicKey: string) => Promise<void>;
  onWalletDisconnected?: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function getFreighterPublicKey(): Promise<string> {
  const result = await freighterGetAddress();
  if (result.error) throw new Error(result.error.message ?? 'Freighter connection failed');
  return result.address;
}

async function getFreighterNetwork(): Promise<'testnet' | 'mainnet' | 'futurenet'> {
  const result = await freighterGetNetwork();
  if (result.error) throw new Error(result.error.message ?? 'Failed to get network');
  const network = result.network;
  if (network !== 'testnet' && network !== 'mainnet' && network !== 'futurenet') {
    return 'testnet';
  }
  return network;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [metrics, setMetrics] = useState<WalletMetrics | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const publicKeyRef = useRef<string | null>(null);
  const disconnectCallbackRef = useRef<(() => void) | null>(null);

  // Shared disconnect handler — used by both real WatchWalletChanges and mock events
  const handleWalletDisconnect = useCallback(
    (newAddress: string | null) => {
      const previousKey = publicKeyRef.current;

      // If the address matches our current key, this isn't a disconnect
      if (newAddress && newAddress === previousKey) return;

      generationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      publicKeyRef.current = null;
      setMetrics(null);
      setError(null);
      setIsConnecting(false);

      // Immediately clear all cached data
      queryClient.clear();

      // Logout from backend if we had a session
      if (previousKey) {
        void (async () => {
          try {
            await fetch('/api/auth/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ publicKey: previousKey }),
            });
            await cacheDelete('authSession', previousKey);
          } catch {
            // best-effort cleanup
          }
        })();

        // Trigger callback for session monitor
        disconnectCallbackRef.current?.();
      }
    },
    [queryClient],
  );

  // Instant wallet disconnection detection using WatchWalletChanges
  useEffect(() => {
    // E2E mock disconnection listener — always registered, guards on isMockMode() at event time
    const onMockChange = (e: Event) => {
      if (!isMockMode()) return;
      const detail = (e as CustomEvent).detail as { address: string | null } | undefined;
      handleWalletDisconnect(detail?.address ?? null);
    };
    window.addEventListener('freighter-wallet-change', onMockChange);

    // Real Freighter watcher — only created when NOT in mock mode at mount time
    let watcher: WatchWalletChanges | null = null;
    if (!isMockMode()) {
      watcher = new WatchWalletChanges(1000); // Poll every 1 second for instant detection

      watcher.watch((event) => {
        // Handle wallet lock, disconnection, or account change
        if (!event.address || event.address !== publicKeyRef.current) {
          handleWalletDisconnect(event.address ?? null);
        } else if (event.address && event.address !== publicKeyRef.current) {
          // Account changed to a different address
          generationRef.current += 1;
          abortControllerRef.current?.abort();
          abortControllerRef.current = null;
          publicKeyRef.current = event.address;
          setMetrics(null);
          setError(null);
          setIsConnecting(false);
          queryClient.clear();
        }
      });
    }

    return () => {
      window.removeEventListener('freighter-wallet-change', onMockChange);
      watcher?.stop();
    };
  }, [queryClient, handleWalletDisconnect]);

  const refreshBalances = useCallback(async (pk: string) => {
    const response = await fetch(`/api/wallet/balances?publicKey=${pk}`);
    if (response.ok) {
      const balances: AssetBalance[] = await response.json();
      setMetrics((prev) => (prev ? { ...prev, balances } : null));
    }
  }, []);

  const connect = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = ++generationRef.current;

    setIsConnecting(true);
    setError(null);

    try {
      // E2E test mock path — bypass real Freighter API
      if (isMockMode()) {
        if (shouldMockError()) {
          throw new Error('Mock Freighter connection error');
        }

        const publicKey = getMockPublicKey();
        const network = 'testnet' as const;
        const balances: AssetBalance[] = [{ asset: 'XLM', balance: '100.0000000', decimals: 7 }];

        if (!controller.signal.aborted && generation === generationRef.current) {
          publicKeyRef.current = publicKey;
          queryClient.clear();
          setMetrics({ publicKey, balances, network, isConnected: true });
        }
        return;
      }

      const publicKey = await getFreighterPublicKey();
      if (controller.signal.aborted || generation !== generationRef.current) return;

      const network = await getFreighterNetwork();
      if (controller.signal.aborted || generation !== generationRef.current) return;

      const response = await fetch(`/api/wallet/balances?publicKey=${publicKey}`);
      const balances: AssetBalance[] = response.ok ? await response.json() : [];

      if (!controller.signal.aborted && generation === generationRef.current) {
        publicKeyRef.current = publicKey;
        queryClient.clear();
        setMetrics({ publicKey, balances, network, isConnected: true });
      }
    } catch (err) {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Wallet connection failed');
      }
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setIsConnecting(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  }, [queryClient]);

  const disconnect = useCallback(async () => {
    const previousKey = publicKeyRef.current;

    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    publicKeyRef.current = null;
    setMetrics(null);
    setError(null);
    queryClient.clear();

    // Logout from backend
    if (previousKey) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: previousKey }),
        });
        await cacheDelete('authSession', previousKey);
      } catch {
        // best-effort cleanup
      }
    }
  }, [queryClient]);

  // Cleanup on unmount and tab close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const pk = publicKeyRef.current;
      if (pk) {
        // Use sendBeacon for reliable cleanup on tab close
        const blob = new Blob([JSON.stringify({ publicKey: pk })], {
          type: 'application/json',
        });
        navigator.sendBeacon('/api/auth/logout', blob);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      abortControllerRef.current?.abort();
    };
  }, []);

  return (
    <WalletContext.Provider
      value={{ metrics, isConnecting, error, connect, disconnect, refreshBalances }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
