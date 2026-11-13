import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import * as util from 'tweetnacl-util';
import * as KeyStore from './keyStore';

export type Signable = {
  transactionId: string;
  merchantId: string;
  customerId: string;
  deviceId: string;
  amount: number;
  currency: string;
  channel: string;
  nonce: string;
  offline: boolean;
  createdAt: string;
};

// Must match canonical() in backend/src/security/signature.js exactly, field for field.
export const canonical = (t: Signable) =>
  [
    t.transactionId,
    t.merchantId,
    t.customerId,
    t.deviceId,
    t.amount,
    t.currency,
    t.channel,
    t.nonce,
    t.offline,
    t.createdAt,
  ].join('|');

// One shared promise, so two calls on a fresh install can't each create a different keypair.
let pair: Promise<nacl.SignKeyPair> | null = null;

function keypair(): Promise<nacl.SignKeyPair> {
  if (!pair) {
    pair = (async () => {
      const stored = await KeyStore.getItem('p2s_secret');
      if (stored) return nacl.sign.keyPair.fromSecretKey(util.decodeBase64(stored));
      const kp = nacl.sign.keyPair();
      await KeyStore.setItem('p2s_secret', util.encodeBase64(kp.secretKey));
      return kp;
    })().catch(e => {
      pair = null;
      throw e;
    });
  }
  return pair;
}

export async function myPublicKey() {
  return util.encodeBase64((await keypair()).publicKey);
}

export async function signTx(t: Signable) {
  const kp = await keypair();
  const sig = nacl.sign.detached(util.decodeUTF8(canonical(t)), kp.secretKey);
  return { signature: util.encodeBase64(sig), publicKey: util.encodeBase64(kp.publicKey) };
}

export const newNonce = () => util.encodeBase64(nacl.randomBytes(12));
