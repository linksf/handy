import {describe,test,expect,vi} from 'vitest';
const {store}=vi.hoisted(()=>({store:new Map()}));
vi.mock('firebase/firestore',()=>({
  doc:(_db,_collection,id)=>({id}),
  runTransaction:async (_db,fn)=>fn({get:async ref=>({exists:()=>store.has(ref.id)}),set:(ref,data)=>store.set(ref.id,data)}),
}));
import {normalizeToolName,toolDocumentId} from './toolNames.js';
import {ensureTool} from './toolCatalogStore.js';
describe('tool identity',()=>{
 test('case, whitespace and Unicode width variants share an ID; distinct tools stay separate',()=>{
  expect(toolDocumentId('  Drill/Driver  ')).toBe(toolDocumentId('DRILL/DRIVER'));
  expect(toolDocumentId('Ｄｒｉｌｌ')).toBe(toolDocumentId('Drill'));
  expect(normalizeToolName('Socket   & Ratchet Set')).toBe('socket & ratchet set');
  expect(toolDocumentId('Hammer Drill')).not.toBe(toolDocumentId('Drill/Driver'));
  expect(toolDocumentId('Outlet/GFCI Tester')).not.toContain('/');
  expect(()=>toolDocumentId(' ')).toThrow();
 });
 test('repeated additions reuse the tool and preserve its category',async()=>{
  store.clear();
  const first=await ensureTool({},'  Drill/Driver ','Power Tools');
  const second=await ensureTool({},'DRILL/DRIVER','');
  expect(first.created).toBe(true);expect(second).toEqual({id:first.id,created:false});
  expect(store.size).toBe(1);expect(store.get(first.id).category).toBe('Power Tools');
 });
});
