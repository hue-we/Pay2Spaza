import { mockApi } from './mock';
import { Merchant, ShopTx, SyncResult, WalletInfo } from './types';
import { cacheMerchant, getCachedMerchant, Tx } from '../database/db';

// Flip to true to run offline/in-memory without hitting the live Render backend.
export const USE_MOCK = false;
export const BASE_URL = 'https://pay2spaza.onrender.com';

// Contract: responses look like { success, data, error }. Returns null on any failure.
async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000); // free hosting can take a while to wake up
  try {
    const res = await fetch(BASE_URL + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
      signal: ctl.signal,
    });
    const body = await res.json();
    return body.success ? (body.data as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const realApi = {
  getWallet: (customerId: string) =>
    call<WalletInfo>(`/api/wallet/${encodeURIComponent(customerId)}`),
  topUpWallet: (customerId: string, amount: number, publicKey: string) =>
    call<WalletInfo>('/api/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ customerId, amount, publicKey }),
    }),
  lookupMerchant: async (id: string): Promise<Merchant | null> => {
    const m = await call<Merchant>(`/api/merchants/${encodeURIComponent(id)}`);
    if (m) {
      cacheMerchant(m).catch(() => {});
      return m;
    }
    return getCachedMerchant(id); // offline or unreachable: use the saved copy
  },
  submitTransactions: async (list: Tx[]): Promise<SyncResult[]> => {
    const res = await call<SyncResult[] | { results: SyncResult[] }>('/api/transactions/sync', {
      method: 'POST',
      body: JSON.stringify({ transactions: list }),
    });
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.results)) return res.results;
    return [];
  },
  // Confirmed payments for a shop, straight from the database. Null means the server could not be reached.
  listMerchantTransactions: async (id: string): Promise<ShopTx[] | null> => {
    const d = await call<{ transactions: any[] }>(`/api/merchants/${encodeURIComponent(id)}/transactions`);
    if (!d) return null;
    return d.transactions.map(x => ({
      transactionId: String(x.transactionId),
      amount: Number(x.amount),
      createdAt: String(x.createdAt),
      channel: String(x.channel ?? 'QR'),
      status: x.status ?? 'CONFIRMED',
    }));
  },
};

// Mock wallets live in memory. Every customer starts with R0, so the first payment is declined until money is added.
const wallets = new Map<string, number>(); // customerId -> cents
const cents = (id: string) => wallets.get(id) ?? 0;
const walletView = (id: string): WalletInfo => ({
  customerId: id,
  balance: cents(id) / 100,
  offlineAllowance: Math.min(200, cents(id) / 100),
});

const mock = {
  ...mockApi,
  listMerchantTransactions: async (_id: string): Promise<ShopTx[] | null> => null,
  getWallet: async (id: string): Promise<WalletInfo | null> => walletView(id),
  topUpWallet: async (id: string, amount: number, _publicKey: string): Promise<WalletInfo | null> => {
    wallets.set(id, cents(id) + Math.round(amount * 100));
    return walletView(id);
  },
  submitTransactions: async (list: Tx[]): Promise<SyncResult[]> => {
    const results = await mockApi.submitTransactions(list);
    return results.map((r, i) => {
      if (r.status !== 'CONFIRMED') return r;
      const t = list[i],
        c = Math.round(t.amount * 100);
      if (cents(t.customerId) < c)
        return { transactionId: r.transactionId, status: 'REJECTED', reason: 'Insufficient funds' } as SyncResult;
      wallets.set(t.customerId, cents(t.customerId) - c);
      return r;
    });
  },
};

export const api = USE_MOCK ? mock : realApi;
