-- diagnose.sql — อ่านอย่างเดียว (ไม่แก้ข้อมูล) รันใน SQL Editor แล้วดูผลทีละบล็อก
-- 1) ผู้ใช้ล็อกอิน (auth) ถูกผูกกับ app_users หรือยัง? แถวที่ role เป็น NULL = ยังไม่ได้ผูก → ซิงค์สินค้าจะโดนบล็อก
select u.email, a.name, a.role, a.is_active, (a.id is not null) as linked
from auth.users u left join app_users a on a.auth_user_id = u.id order by u.created_at;

-- 2) OWNER ปัจจุบันผูกกับบัญชีไหน (auth_user_id ว่าง/ไม่ตรง = ต้องผูกใหม่)
select id, name, role, auth_user_id from app_users where role = 'OWNER';

-- 3) จำนวนแถวในตารางหลัก
select 'products' t, count(*) from products union all
select 'product_variants', count(*) from product_variants union all
select 'categories', count(*) from categories union all
select 'customers', count(*) from customers;

-- 4) รูปสินค้า: bucket public ไหม + มีไฟล์กี่ไฟล์ + มีสินค้ากี่ตัวที่มี image_url
select id, public, file_size_limit from storage.buckets where id = 'product-images';
select count(*) as files_in_storage from storage.objects where bucket_id = 'product-images';
select count(*) filter (where image_url is not null) as with_url,
       count(*) filter (where image_url ~ '^(data:|blob:)') as bad_local_urls
from products;

-- 5) นโยบายที่มีผลต่อการเขียนสินค้า/รูป
select tablename, policyname, cmd from pg_policies
where (schemaname = 'public' and tablename in ('products','categories','product_variants'))
   or (schemaname = 'storage' and tablename = 'objects' and policyname like '%product_images%')
order by tablename, policyname;
