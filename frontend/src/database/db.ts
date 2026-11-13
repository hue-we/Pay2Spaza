import * as SQLite from 'expo-sqlite';
import type { Merchant } from '../api/types';

import type { Tx } from './types';
export type { Tx } from './types';

import { Platform } from 'react-native';

export type Tx = {
  transactionId: string;
  merchantId: string;
  customerId: string;
  deviceId: string;
  amount: number;
  currency: string;
  channel: 'QR' | 'USSD';
  nonce: string;
  offline: boolean;
  createdAt: string;
  signature: string;
  publicKey: string;
  status: 'LOCAL_PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
};


// In-memory array storage fallback to hold data on the web
let webDbMemory: any[] = [];
let db: any = null;

export async function getDb() {
  // 1. If running on Web, immediately return a safe mock object
  if (Platform.OS === 'web') {
    return {
      runAsync: async () => {},
      execAsync: async () => {},
      getAllAsync: async () => []
    };
  }

  // 2. Only import expo-sqlite dynamically on native devices (iOS/Android)
  if (!db) {
    const SQLite = require('expo-sqlite');
    db = await SQLite.openDatabaseAsync('pay2spaza.db');
    await db.execAsync(`CREATE TABLE IF NOT EXISTS tx (
      transactionId TEXT PRIMARY KEY, merchantId TEXT, customerId TEXT, deviceId TEXT,
      amount REAL, currency TEXT, channel TEXT, nonce TEXT, offline INTEGER,
      createdAt TEXT, signature TEXT, publicKey TEXT, status TEXT);`);
  }
  return db;
}

export async function saveTx(t: Tx) {
  if (Platform.OS === 'web') {
    webDbMemory.push({ ...t, offline: t.offline ? 1 : 0 });
    return;
  }

  const d = await getDb();
  await d.runAsync(
    'INSERT INTO tx VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [t.transactionId, t.merchantId, t.customerId, t.deviceId, t.amount, t.currency, t.channel,
     t.nonce, t.offline ? 1 : 0, t.createdAt, t.signature, t.publicKey, t.status]
  );
}

export async function getPending(): Promise<Tx[]> {
  if (Platform.OS === 'web') {
    return webDbMemory
      .filter(r => r.status === 'LOCAL_PENDING')
      .map(r => ({ ...r, offline: !r.offline }));
  }

  const d = await getDb();
  const rows = await d.getAllAsync<any>('SELECT * FROM tx WHERE status=\'LOCAL_PENDING\'');
  return rows.map(r => ({ ...r, offline: !r.offline }));
}

export async function setStatus(id: string, status: Tx['status']) {
  if (Platform.OS === 'web') {
    const target = webDbMemory.find(r => r.transactionId === id);
    if (target) target.status = status;
    return;
  }

  const d = await getDb();
  await d.runAsync('UPDATE tx SET status=? WHERE transactionId=?', [status, id]);
}

export async function history(): Promise<Tx[]> {
  if (Platform.OS === 'web') {
    return [...webDbMemory]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(r => ({ ...r, offline: !r.offline }));
  }

  const d = await getDb();
  const rows = await d.getAllAsync<any>('SELECT * FROM tx ORDER BY createdAt DESC');
  return rows.map(r => ({ ...r, offline: !r.offline }));
}

// Merchant cache: lets a shop already looked up be found again while offline.
async function getMerchantTable() {
  const d = await getDb();
  await d.execAsync(`CREATE TABLE IF NOT EXISTS merchant (
    id TEXT PRIMARY KEY, name TEXT, ownerFirstName TEXT);`);
  return d;
}
export async function cacheMerchant(m: Merchant) {
  const d = await getMerchantTable();
  await d.runAsync(`INSERT OR REPLACE INTO merchant VALUES (?,?,?)`, [m.id, m.name, m.ownerFirstName]);
}
export async function getCachedMerchant(id: string): Promise<Merchant | null> {
  try {
    const d = await getMerchantTable();
    return (await d.getFirstAsync<Merchant>(`SELECT * FROM merchant WHERE id=?`, [id])) ?? null;
  } catch { return null; }
}
