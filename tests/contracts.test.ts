import { describe, it, expect } from 'vitest';
import { safeRelativePath, DownloadUrl, compareVersions, resolvePlan, validatePublication, PackageSpec } from '../packages/contracts/src/index';
import { seedPackages } from '../backend/src/seed';
describe('installation boundary',()=>{
  it.each(['../escape','C:\\Windows\\x','/etc/passwd','\\\\host\\share','a/../../b','a:ads','CON.ini','dir/NUL','x.','x ','a//b','.uhm/state.json','a/COM1.txt','a\u0000b'])('rejects unsafe path %s',p=>expect(safeRelativePath(p)).toBe(false));
  it.each(['extension/config/pure.ini','content/cars/car/model.kn5','پوشه/تست.ini'])('accepts relative game path %s',p=>expect(safeRelativePath(p)).toBe(true));
  it.each(['http://example.com/x','https://user:pass@example.com/x','https://127.0.0.1/x','https://169.254.169.254/x','https://[::1]/x','https://localhost/x','https://192.168.1.2/x','https://10.0.0.1/x','https://example.com:8080/x'])('rejects unsafe download %s',u=>expect(DownloadUrl.safeParse(u).success).toBe(false));
  it('accepts public HTTPS',()=>expect(DownloadUrl.safeParse('https://downloads.example.com/test.zip').success).toBe(true));
});
describe('package graph',()=>{
  it('sorts dependencies before main package',()=>{const p=seedPackages();expect(resolvePlan(p[0].id,p,'pro').map(p=>p.id)).toEqual([p[2].id,p[0].id]);});
  it('deduplicates shared dependencies',()=>{const p=seedPackages();p[0].dependencies=[p[2].id,p[2].id];expect(resolvePlan(p[0].id,p,'pro')).toHaveLength(2);});
  it('rejects cycles',()=>{const p=seedPackages();p[2].dependencies=[p[0].id];expect(()=>resolvePlan(p[0].id,p,'pro')).toThrow('DEPENDENCY_CYCLE');});
  it('checks dependency subscription separately',()=>{const p=seedPackages();p[2].tier='vip';expect(()=>resolvePlan(p[0].id,p,'pro')).toThrow('TIER_REQUIRED');});
  it('rejects unpublished dependency',()=>{const p=seedPackages();p[2].status='draft';expect(()=>resolvePlan(p[0].id,p,'pro')).toThrow('DEPENDENCY_UNAVAILABLE');});
  it('never publishes a presentation-only package',()=>{const p=seedPackages();expect(()=>validatePublication(p[0],p)).toThrow('EMPTY_INSTALL_PLAN');});
  it('compares numbers not strings',()=>expect(compareVersions('1.10.0','1.9.9')).toBeGreaterThan(0));
  it('validates sample metadata',()=>seedPackages().forEach(p=>expect(PackageSpec.safeParse(p).success).toBe(true)));
});
