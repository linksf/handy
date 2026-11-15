import {doc, runTransaction} from 'firebase/firestore';
import {toolDocumentId} from './toolNames.js';

// Transactions and a stable document ID prevent simultaneous imports/adds racing.
export async function ensureTool(db, name, category = '') {
  const cleanName = String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const ref = doc(db, 'tools', toolDocumentId(cleanName));
  const created = await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists()) return false;
    transaction.set(ref, {name:cleanName, category:String(category || '').trim()});
    return true;
  });
  return {id:ref.id, created};
}
