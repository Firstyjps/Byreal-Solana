import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.generate();

// แสดง Public Key
console.log("Public Key:", kp.publicKey.toBase58());

// แสดง Secret Key (base58)
console.log("Private Key (base58):", bs58.encode(kp.secretKey));
