import {describe,it,expect} from 'vitest';
import {replaceBlockedStockScene} from '../../sidecars';
describe('blocked composite stock recovery',()=>{
 const make=()=>({scenes:[{kind:'video',start:0,end:1,file:'a',offset:3},{kind:'video',start:1,end:2,file:'b',offset:4},{kind:'source',start:2,end:3}]});
 it('replaces only the blocked interval with actual original timing',()=>{
  const p=make();expect(replaceBlockedStockScene(p,1)).toBe(true);
  expect(p.scenes[0]!.kind).toBe('video');expect(p.scenes[1]).toMatchObject({kind:'source',start:1,end:2});
  expect(p.scenes[1]).not.toHaveProperty('offset');expect(p.scenes[1]).not.toHaveProperty('file');
 });
 it('fails closed for original footage or no remaining stock',()=>{
  const p=make();expect(replaceBlockedStockScene(p,2)).toBe(false);
  expect(replaceBlockedStockScene(p,.5)).toBe(true);expect(replaceBlockedStockScene(p,1.5)).toBe(false);
 });
 it('rejects unlocated findings',()=>{for(const t of [NaN,Infinity,-1,9])expect(replaceBlockedStockScene(make(),t)).toBe(false);});
});
