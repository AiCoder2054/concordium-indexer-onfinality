import { Transfer, TransferEvent } from '../types';

// These 'any' types are used to avoid tight coupling to a specific SDK version.
// OnFinality will compile this project; if you have the Concordium types available,
// you can replace these with the proper imports from '@subql/types-concordium'.
type ConcordiumTransaction = any;
type ConcordiumTransactionEvent = any;

function toBigIntSafe(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  // Fallback for SDK numeric wrappers (e.g., { toString() } or { toJSON() })
  if (value && typeof (value as any).toString === 'function') {
    const s = (value as any).toString();
    try {
      return BigInt(s);
    } catch {
      /* ignore */
    }
  }
  return BigInt(0);
}

/**
 * Index Concordium account transfer transactions.
 * This handler is filtered in project.yaml to only receive AccountTransaction of type 'transfer'.
 */
export async function handleAccountTransfer(tx: ConcordiumTransaction): Promise<void> {
  const blockHeight =
    tx?.block?.blockHeight ??
    tx?.blockHeight ??
    tx?.block?.height ??
    0;

  const hash: string =
    tx?.hash ??
    tx?.transactionHash ??
    tx?.id ??
    `${blockHeight}-${tx?.index ?? '0'}`;

  const sender: string =
    tx?.sender ??
    tx?.from ??
    tx?.accountAddress ??
    tx?.account ??
    '';

  // Depending on SDK version, the transfer details may sit on tx.payload.{to,amount} or similar.
  const payload = tx?.payload ?? tx?.details ?? {};
  const receiver: string = payload?.to ?? payload?.receiver ?? payload?.toAddress ?? '';
  const amount: bigint = toBigIntSafe(payload?.amount ?? payload?.value ?? 0);

  const id = `${blockHeight}-${hash}`;

  const entity = new Transfer(id);
  entity.blockHeight = BigInt(blockHeight);
  entity.sender = String(sender);
  entity.receiver = String(receiver);
  entity.amount = amount;
  entity.transactionHash = String(hash);

  await entity.save();
}

/**
 * Index Concordium 'Updated' transaction events (commonly emitted on successful updates).
 * This is a simple example to show event handling alongside transactions.
 */
export async function handleUpdatedEvent(ev: ConcordiumTransactionEvent): Promise<void> {
  const blockHeight =
    ev?.block?.blockHeight ??
    ev?.blockHeight ??
    ev?.block?.height ??
    0;

  const tag: string = ev?.tag ?? ev?.type ?? 'Updated';
  const txHash: string = ev?.transactionHash ?? ev?.txHash ?? ev?.hash ?? '';

  const id = `${blockHeight}-${ev?.id ?? ev?.index ?? txHash}`;

  const e = new TransferEvent(id);
  e.blockHeight = BigInt(blockHeight);
  e.tag = String(tag);
  e.transactionHash = String(txHash);

  await e.save();
}