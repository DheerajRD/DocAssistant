import { DB,check } from './supabase';
import { DocRecord,DocumentType,Fields,maskedFields } from './documents';
export const childTables:Record<DocumentType,string>={PASSPORT:'passports',VISA:'visas',I20:'i20_records',I94:'i94_records',CPT:'cpt_authorizations',EAD:'ead_records'};
export async function loadDocuments(db:DB,userId:string):Promise<DocRecord[]>{
  const {data,error}=await db.from('documents').select('*').eq('user_id',userId).is('deleted_at',null).order('created_at',{ascending:false});check(error);
  const docs=(data||[]) as DocRecord[];
  const groups=await Promise.all(Object.entries(childTables).map(async([type,table])=>{
    const {data,error}=await db.from(table).select('*').eq('user_id',userId);check(error);return {type,rows:data||[]};
  }));
  for(const d of docs){
    const row=groups.find(g=>g.type===d.document_type)?.rows.find(r=>r.document_id===d.id);
    d.fields={};if(row)for(const [key,value]of Object.entries(row))if(!['document_id','user_id'].includes(key))d.fields[key]=value as Fields[string];
  }
  return docs;
}
export function publicDocument(d:DocRecord,reveal=false){
  // Internal storage path and user id never leave the service.
  return {id:d.id,document_type:d.document_type,status:d.status,created_at:d.created_at,issue_date:d.issue_date,is_current:d.is_current,current_source:d.current_source,reviewed_at:d.reviewed_at,fields:reveal?d.fields:maskedFields(d.fields),confidence:d.confidence};
}
export async function audit(db:DB,userId:string,action:string,documentId?:string){
  const {error}=await db.from('audit_logs').insert({user_id:userId,action,document_id:documentId??null});check(error);
}
