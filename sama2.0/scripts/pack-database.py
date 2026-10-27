"""发布者运行：压缩、分片和计算指纹。不会读取API配置。"""
from pathlib import Path
import argparse,gzip,hashlib,json,sqlite3
p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('--out',default=str(Path(__file__).resolve().parent.parent/'database-pack'));a=p.parse_args();db=Path(a.database).resolve();out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
if (out/'manifest.json').exists() or list(out.glob('part-*.gzpart')):raise SystemExit('已有分发包，拒绝覆盖')
CHUNK=16*1024*1024
class Parts:
 def __init__(self):self.f=None;self.bytes=0;self.h=hashlib.sha256();self.files=[];self.index=-1;self.compressed=hashlib.sha256();self.total=0
 def next(self):
  if self.f:self.close_part()
  self.index+=1;self.name=f'part-{self.index:03d}.gzpart';self.f=(out/self.name).open('xb');self.bytes=0;self.h=hashlib.sha256()
 def close_part(self):self.f.close();self.files.append({'file':self.name,'bytes':self.bytes,'sha256':self.h.hexdigest()});self.f=None
 def write(self,data):
  view=memoryview(data);n=len(view)
  while view:
   if self.f is None or self.bytes==CHUNK:self.next()
   portion=view[:CHUNK-self.bytes];self.f.write(portion);self.bytes+=len(portion);self.h.update(portion);self.compressed.update(portion);self.total+=len(portion);view=view[len(portion):]
  return n
 def flush(self):
  if self.f:self.f.flush()
parts=Parts();h=hashlib.sha256();size=0
with gzip.GzipFile(filename='',mode='wb',fileobj=parts,mtime=0,compresslevel=6) as gz, db.open('rb') as source:
 for data in iter(lambda:source.read(2**20),b''):
  h.update(data);size+=len(data);gz.write(data)
  if size%(128*1024*1024)==0:print('已压缩源文件MiB',size//1024**2,flush=True)
parts.close_part()
c=sqlite3.connect(db.as_uri()+'?mode=ro');counts={t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['units','full_fragments','full_assets','case_relations','legacy_rows']};ref=c.execute('select count(*) from full_fragments where reference_allowed=1').fetchone()[0];c.close()
m={'format':'sama-sqlite-gzip-parts-v1','version':'2026-10-27','databaseFile':'sama_full.sqlite','databaseBytes':size,'databaseSha256':h.hexdigest(),'compressedBytes':parts.total,'compressedSha256':parts.compressed.hexdigest(),'partSizeMax':CHUNK,'parts':parts.files,'counts':counts,'referenceFragments':ref,'assetsBundled':False,'originalSourcesBundled':False,'professionalApproved':0,'defaultMode':'reference','scope':'完整文本与索引主库；原PDF/LAD/图像仅有来源与指纹，未随包分发。'}
(out/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'parts':len(parts.files),'compressedBytes':parts.total,'databaseBytes':size},ensure_ascii=False),flush=True)
