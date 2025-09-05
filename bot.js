import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey
} from '@solana/web3.js';

// ================= CONFIG =================
const JUP_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUP_SWAP = 'https://quote-api.jup.ag/v6/swap';

// โหลดกระเป๋า
const secret = bs58.decode(process.env.PRIVATE_KEY_BASE58.trim());
const wallet = Keypair.fromSecretKey(secret);
console.log('Bot pubkey:', wallet.publicKey.toBase58());

// RPC
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// ใช้ WSOL เป็นตัวแทน SOL
const WSOL_MINT = new PublicKey(
  'So11111111111111111111111111111111111111112'
);

// ================= HELPERS =================
async function getInputBalanceUi(conn, owner, mintPk) {
  if (mintPk.equals(WSOL_MINT)) {
    const lamports = await conn.getBalance(owner);
    return { raw: lamports, decimals: 9, ui: lamports / 1e9 };
  }
  const ataList = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintPk });
  let amount = 0,
    decimals = 0;
  if (ataList.value.length > 0) {
    const acc = ataList.value[0].account.data.parsed.info.tokenAmount;
    amount = Number(acc.amount);
    decimals = acc.decimals;
  } else {
    const sup = await conn.getTokenSupply(mintPk);
    decimals = sup.value.decimals;
  }
  return { raw: amount, decimals, ui: amount / 10 ** decimals };
}

function toBaseUnits(amountUi, decimals) {
  return Math.floor(Number(amountUi) * 10 ** decimals);
}

async function resolveFragMint() {
  if (process.env.FRAG_MINT) return new PublicKey(process.env.FRAG_MINT.trim());
  const url = 'https://tokens.jup.ag/tokens?tags=verified,community';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Fetch token list failed');
  const list = await res.json();
  const cand = list.find((t) => (t.symbol || '').toUpperCase() === 'FRAG');
  if (!cand) throw new Error('FRAG mint not found. Set FRAG_MINT in .env');
  return new PublicKey(cand.address);
}

async function oneSwapExactInHuman(
  inputMint,
  outputMint,
  amountUi,
  slippageBps = 100
) {
  const bal = await getInputBalanceUi(connection, wallet.publicKey, inputMint);
  const amountBase = toBaseUnits(amountUi, bal.decimals);

  if (bal.raw < amountBase) {
    throw new Error(
      `Insufficient balance: have ${bal.ui}, need ${amountUi}`
    );
  }

  const url = new URL(JUP_QUOTE);
  url.searchParams.set('inputMint', inputMint.toBase58());
  url.searchParams.set('outputMint', outputMint.toBase58());
  url.searchParams.set('amount', String(amountBase));
  url.searchParams.set('slippageBps', String(slippageBps));
  url.searchParams.set('swapMode', 'ExactIn');

  const q = await (await fetch(url)).json();

  const payload = {
    quoteResponse: q,
    userPublicKey: wallet.publicKey.toBase58(),
    dynamicComputeUnitLimit: true
  };
  const sw = await fetch(JUP_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const swJson = await sw.json();

  const tx = VersionedTransaction.deserialize(
    Buffer.from(swJson.swapTransaction, 'base64')
  );
  tx.sign([wallet]);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 3
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ================= MAIN =================
async function main() {
  console.log('Start swap: SOL → FRAG');
  const MINT_SOL = WSOL_MINT;
  const MINT_FRAG = await resolveFragMint();
  console.log('FRAG mint:', MINT_FRAG.toBase58());

  const AMOUNT_SOL_UI = 0.005; // จำนวน SOL ต่อรอบ
  const SLIPPAGE_BPS = 100; // 1% slippage
  const ROUNDS = 3; // จำนวนรอบที่จะสวอป

  for (let i = 1; i <= ROUNDS; i++) {
    try {
      const sig = await oneSwapExactInHuman(
        MINT_SOL,
        MINT_FRAG,
        AMOUNT_SOL_UI,
        SLIPPAGE_BPS
      );
      console.log(`#${i} SOL→FRAG tx:`, sig);
    } catch (e) {
      console.error('Round error:', e.message);
    }
    await sleep(3000);
  }

  console.log('Done.');
}

main().catch(console.error);
