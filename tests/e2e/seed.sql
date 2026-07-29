-- Datos mínimos para el ensayo de extremo a extremo: una empresa, una sucursal,
-- un cajero, catálogo con precios y rangos NCF vigentes.
insert into public.companies (id, trade_name, legal_name, tax_id, tax_rate_bps, currency_symbol)
values ('11111111-1111-1111-1111-111111111111','Car Wash E2E','E2E SRL','999-99999-9',1800,'RD$');

insert into public.branches (id, company_id, name, is_main)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Sucursal E2E', true);

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333','cajero@example.com');

update public.profiles
   set company_id='11111111-1111-1111-1111-111111111111',
       branch_id ='22222222-2222-2222-2222-222222222222',
       role='cajero', full_name='Cajero E2E'
 where id='33333333-3333-3333-3333-333333333333';

insert into public.services (id, company_id, code, name, description)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
        'LAV','Lavado Completo','Exterior, interior y aspirado');

insert into public.service_prices (service_id, vehicle_category, price_cents) values
  ('44444444-4444-4444-4444-444444444444','sedan',100000),
  ('44444444-4444-4444-4444-444444444444','suv',150000);

insert into public.products (id, company_id, branch_id, code, name, price_cents, cost_cents, stock, min_stock, unit)
values ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222','AR1','Aromatizante',25000,10000,10,2,'Unidad');

insert into public.ncf_sequences (company_id, ncf_type, range_start, range_end, next_value, authorized_until)
values ('11111111-1111-1111-1111-111111111111','B02',1,100,1, current_date + 365),
       ('11111111-1111-1111-1111-111111111111','B04',1,100,1, current_date + 365);
