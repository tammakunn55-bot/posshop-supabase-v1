/* Smart POS V4 compatibility patch — load AFTER 04-supabase.js.
 * Uses the SMARTPOS_V4_SINGLE_RUN.sql schema plus compatibility migration: store_id + UUID PKs.
 * Keeps local P-/V-/F- identifiers in local_id columns; no owner_id writes.
 * IMPORTANT: deliberately omits stock so a stale local cache cannot overwrite cloud stock.
 */
(() => {
  'use strict';
  const vals = x => Array.isArray(x) ? x : Object.values(x || {});
  const idOf = x => String(x?.id ?? '').trim();
  const num = (x,d=0) => Number.isFinite(Number(x)) ? Number(x) : d;
  const client = () => {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c=window.getSupabaseClient(); if(!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key'); return c;
  };
  async function storeId(c) {
    const {data,error}=await c.rpc('get_my_store');
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้าน (store membership)');
    localStorage.setItem('POS_STORE_ID',row.store_id);
    localStorage.setItem('POS_STORE_NAME',row.store_name||'');
    localStorage.setItem('POS_STORE_ROLE',row.role||'');
    return row.store_id;
  }
  window.syncProductsToSupabase = async function(isQuiet=false) {
    const c=client();
    try {
      const {data:authData,error:authError}=await c.auth.getUser();
      if(authError) throw authError;
      if(!authData?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนซิงค์');
      const sid=await storeId(c), db=window.db||{};
      const categories=vals(db.categories).filter(x=>idOf(x)&&String(x.name||'').trim());
      const catRows=categories.map(x=>({store_id:sid,local_id:idOf(x),name:String(x.name).trim(),active:x.active!==false}));
      let catMap=new Map();
      if(catRows.length){
        const {data,error}=await c.from('categories').upsert(catRows,{onConflict:'store_id,local_id'}).select('id,local_id');
        if(error) throw new Error('categories: '+error.message);
        catMap=new Map((data||[]).map(x=>[x.local_id,x.id]));
      }
      const products=vals(db.products).filter(x=>idOf(x));
      const pRows=products.map(p=>({store_id:sid,local_id:idOf(p),name:String(p.name||'ไม่ระบุสินค้า'),brand:p.brand||null,description:p.description||null,group_name:p.groupName||p.group_name||null,primary_image_path:p.imageStoragePath||null,active:!p.isDeleted}));
      let pMap=new Map();
      if(pRows.length){
        const {data,error}=await c.from('products').upsert(pRows,{onConflict:'store_id,local_id'}).select('id,local_id');
        if(error) throw new Error('products: '+error.message);
        pMap=new Map((data||[]).map(x=>[x.local_id,x.id]));
      }
      const links=[];
      for(const p of products){const pid=pMap.get(idOf(p)); for(const name of (p.cat||[])){const cat=categories.find(x=>x.name===name);const cid=cat&&catMap.get(idOf(cat));if(pid&&cid)links.push({store_id:sid,product_id:pid,category_id:cid});}}
      if(pMap.size){const ids=[...pMap.values()];const {error}=await c.from('product_categories').delete().eq('store_id',sid).in('product_id',ids);if(error)throw new Error('product_categories delete: '+error.message);if(links.length){const ins=await c.from('product_categories').upsert(links,{onConflict:'product_id,category_id'});if(ins.error)throw new Error('product_categories: '+ins.error.message);}}
      const vRows=[];
      for(const p of products){const pid=pMap.get(idOf(p));if(!pid)continue;for(const v of (p.variants||[])){const vid=idOf(v);if(!vid)continue;vRows.push({store_id:sid,local_id:vid,product_id:pid,sku:String(v.sku||v.barcode||vid).slice(0,120),barcode:v.barcode||null,unit:String(v.unit||v.sizeName||'ชิ้น'),cost:Math.max(0,num(v.cost)),selling_price:Math.max(0,num(v.price??v.selling_price)),min_stock:Math.max(0,num(v.minStock??v.min_stock)),active:v.active!==false});}}
      let vMap=new Map();
      if(vRows.length){
        const {data,error}=await c.from('product_variants').upsert(vRows,{onConflict:'store_id,local_id'}).select('id,local_id,sku');
        if(error)throw new Error('product_variants: '+error.message);
        for(const row of (data||[])){vMap.set(row.local_id,row.id);if(row.sku)vMap.set(row.sku,row.id);}
      }
      // Sync fraction units separately from base SKU stock. Fraction multiplier means
      // how many base-stock units one fraction consumes; fraction price is per fraction.
      const fractionRows=[];
      const fractionLocalIdsByVariant=new Map();
      for(const p of products){
        for(const v of (p.variants||[])){
          const variantId=vMap.get(idOf(v)); if(!variantId)continue;
          const fractions=Array.isArray(v.fractions)?v.fractions:[];
          const localIds=[];
          for(const f of fractions){
            const fid=idOf(f); const multiplier=num(f.fractionMultiplier??f.multiplier,0);
            const fractionPrice=num(f.fractionPrice??f.fraction_price,0);
            if(!fid || multiplier<=0 || fractionPrice<0)continue;
            localIds.push(fid);
            fractionRows.push({store_id:sid,variant_id:variantId,local_id:fid,
              fraction_name:String(f.fractionName||f.fraction_name||'หน่วยย่อย').trim().slice(0,120),
              multiplier,fraction_price:fractionPrice,active:true});
          }
          fractionLocalIdsByVariant.set(variantId,localIds);
        }
      }
      if(fractionRows.length){
        const {error}=await c.from('product_fractions').upsert(fractionRows,{onConflict:'store_id,local_id'});
        if(error)throw new Error('product_fractions: '+error.message);
      }
      // Deactivate removed local fractions instead of deleting history-linked UUID rows.
      for(const [variantId,keepIds] of fractionLocalIdsByVariant){
        const {data:existingFractions,error:staleError}=await c.from('product_fractions')
          .select('id,local_id').eq('store_id',sid).eq('variant_id',variantId).eq('active',true);
        if(staleError)throw new Error('product_fractions stale lookup: '+staleError.message);
        const keepSet=new Set(keepIds);
        const staleIds=(existingFractions||[]).filter(x=>!keepSet.has(x.local_id)).map(x=>x.id);
        if(staleIds.length){const upd=await c.from('product_fractions').update({active:false,updated_at:new Date().toISOString()}).eq('store_id',sid).in('id',staleIds);if(upd.error)throw new Error('product_fractions deactivate: '+upd.error.message);}
      }
      if(!isQuiet && typeof window.showToast==='function') window.showToast(`ซิงค์สินค้า ${pRows.length} รายการ รุ่นสินค้า ${vRows.length} รายการ และหน่วยย่อย ${fractionRows.length} รายการสำเร็จ`);
      return {ok:true,products:pRows.length,variants:vRows.length,fractions:fractionRows.length};
    } catch(e) { console.error('[Supabase V4 sync]',e); if(!isQuiet && typeof window.showAlert==='function') window.showAlert('ซิงค์ไม่สำเร็จ',e.message,true); throw e; }
  };
  window.checkSupabaseV4Health=async function(){
    const result={client:false,session:false,store:false,products:false,error:null};
    try{const c=client();result.client=true;const {data,error}=await c.auth.getSession();if(error)throw error;result.session=!!data?.session;if(!result.session)throw new Error('not_authenticated');await storeId(c);result.store=true;const q=await c.from('products').select('id',{head:true,count:'exact'});if(q.error)throw q.error;result.products=true;}catch(e){result.error=e.message||String(e);}return result;
  };
})();
