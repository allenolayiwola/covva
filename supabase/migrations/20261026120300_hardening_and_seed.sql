-- Hardening -----------------------------------------------------------------------
revoke execute on function public.verify_audit_chain(int) from public, anon;
grant execute on function public.verify_audit_chain(int) to authenticated, service_role;

-- =============================================================================
-- Reference & demo data. Organisations marked settings.demo = true are fictional
-- and must be replaced by real, NIC-verified partners before launch.
-- =============================================================================

-- Categories (all set to integrated per launch decision; availability is admin-controlled)
insert into public.product_categories
  (slug, name, short_description, description, icon, segment, availability, sort_order, default_sla_hours, required_documents, regulatory_note, risk_schema, launch_checklist)
values
('motor', 'Motor', 'Comprehensive, third-party fire & theft and third-party cover for private and commercial vehicles.',
 'Compare motor cover on what matters: own-damage excess, windscreen cover, third-party property limits and key exclusions — not just price.',
 'car', 'personal', 'integrated', 10, 24, '{vehicle_registration,drivers_licence}', null,
 '[{"key":"cover_type","label":"Type of cover","type":"select","required":true,"options":[{"value":"comprehensive","label":"Comprehensive"},{"value":"third_party_fire_theft","label":"Third party, fire & theft"},{"value":"third_party","label":"Third party only"}]},
   {"key":"vehicle_make","label":"Vehicle make","type":"text","required":true,"placeholder":"Toyota"},
   {"key":"vehicle_model","label":"Model","type":"text","required":true,"placeholder":"Corolla"},
   {"key":"vehicle_year","label":"Year of manufacture","type":"number","required":true,"min":1990,"max":2027},
   {"key":"vehicle_value","label":"Estimated vehicle value (GH₵)","type":"currency","required":true,"min":5000},
   {"key":"registration_number","label":"Registration number","type":"text","required":false,"placeholder":"GR 1234-24"},
   {"key":"use","label":"How is the vehicle used?","type":"select","required":true,"options":[{"value":"private","label":"Private use"},{"value":"commercial","label":"Commercial / ride-hailing"}]},
   {"key":"driver_age","label":"Main driver age","type":"number","required":true,"min":18,"max":90},
   {"key":"claims_last_3_years","label":"Claims in the last 3 years","type":"number","required":true,"min":0,"max":20},
   {"key":"region","label":"Region","type":"region","required":true}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('travel', 'Travel', 'Medical emergencies, trip cancellation, lost baggage and Schengen-compliant cover.',
 'Single-trip and annual cover with clear medical limits and pre-existing condition terms shown side by side.',
 'plane', 'personal', 'integrated', 20, 12, '{id_document}', null,
 '[{"key":"destination_region","label":"Destination","type":"select","required":true,"options":[{"value":"africa","label":"Africa"},{"value":"schengen","label":"Europe (Schengen)"},{"value":"worldwide","label":"Worldwide incl. USA"}]},
   {"key":"departure_date","label":"Departure date","type":"date","required":true},
   {"key":"trip_days","label":"Trip length (days)","type":"number","required":true,"min":1,"max":365},
   {"key":"travellers","label":"Number of travellers","type":"number","required":true,"min":1,"max":10},
   {"key":"oldest_traveller_age","label":"Age of oldest traveller","type":"number","required":true,"min":0,"max":90},
   {"key":"purpose","label":"Purpose","type":"select","required":true,"options":[{"value":"leisure","label":"Leisure"},{"value":"business","label":"Business"},{"value":"study","label":"Study"}]}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('personal-accident', 'Personal accident & hospital cash', 'Lump sums for accidental injury, plus daily cash while in hospital.',
 'Simple, affordable protection designed for informal-sector workers and families, with flexible mobile money payments.',
 'shield-plus', 'personal', 'integrated', 30, 24, '{id_document}', null,
 '[{"key":"sum_insured","label":"Accident benefit (GH₵)","type":"currency","required":true,"min":5000,"max":500000},
   {"key":"hospital_cash_daily","label":"Daily hospital cash (GH₵)","type":"select","required":true,"options":[{"value":"0","label":"None"},{"value":"50","label":"GH₵ 50 / day"},{"value":"100","label":"GH₵ 100 / day"},{"value":"200","label":"GH₵ 200 / day"}]},
   {"key":"occupation","label":"Occupation","type":"text","required":true},
   {"key":"occupation_class","label":"Type of work","type":"select","required":true,"options":[{"value":"office","label":"Office / low risk"},{"value":"trade","label":"Trade or market work"},{"value":"manual","label":"Manual / transport"}]},
   {"key":"age","label":"Your age","type":"number","required":true,"min":18,"max":70}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('home', 'Home & contents', 'Buildings and contents cover against fire, flood, burglary and accidental damage.',
 'Cover your home and belongings with clear limits on valuables and the flood and burglary conditions that matter.',
 'home', 'personal', 'integrated', 40, 48, '{photo,proof_of_address}', null,
 '[{"key":"cover_scope","label":"What to cover","type":"select","required":true,"options":[{"value":"buildings_contents","label":"Building and contents"},{"value":"contents","label":"Contents only (renting)"},{"value":"buildings","label":"Building only"}]},
   {"key":"building_value","label":"Rebuild value (GH₵)","type":"currency","required":false,"min":0},
   {"key":"contents_value","label":"Contents value (GH₵)","type":"currency","required":true,"min":0},
   {"key":"construction","label":"Construction","type":"select","required":true,"options":[{"value":"block","label":"Concrete / block"},{"value":"mixed","label":"Mixed materials"},{"value":"wood","label":"Wood"}]},
   {"key":"security","label":"Security measures","type":"multiselect","required":false,"options":[{"value":"burglar_bars","label":"Burglar bars"},{"value":"watchman","label":"Security guard"},{"value":"alarm","label":"Alarm"},{"value":"fence","label":"Fenced compound"}]},
   {"key":"flood_zone","label":"Has the property flooded before?","type":"boolean","required":true},
   {"key":"region","label":"Region","type":"region","required":true}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('health', 'Private health', 'Private health plans covering outpatient, inpatient and maternity care.',
 'Compare private health plans by hospital network, annual limits, waiting periods and exclusions.',
 'heart', 'personal', 'integrated', 50, 48, '{id_document,medical}',
 'Private health-insurance schemes are subject to National Health Insurance Act considerations. A separate product and regulatory assessment is required before this category is offered publicly.',
 '[{"key":"members","label":"People to cover","type":"number","required":true,"min":1,"max":10},
   {"key":"oldest_member_age","label":"Age of oldest member","type":"number","required":true,"min":0,"max":80},
   {"key":"plan_level","label":"Plan level","type":"select","required":true,"options":[{"value":"essential","label":"Essential (inpatient)"},{"value":"standard","label":"Standard (in + outpatient)"},{"value":"premium","label":"Premium (incl. maternity, dental, optical)"}]},
   {"key":"pre_existing_conditions","label":"Any pre-existing conditions?","type":"boolean","required":true},
   {"key":"region","label":"Region","type":"region","required":true}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('life-funeral', 'Life & funeral', 'Term life and funeral cover to protect your family.',
 'Funeral plans and term life cover with clear waiting periods and beneficiary details.',
 'users', 'personal', 'integrated', 60, 48, '{id_document}', null,
 '[{"key":"plan_type","label":"Plan type","type":"select","required":true,"options":[{"value":"funeral","label":"Funeral cover"},{"value":"term_life","label":"Term life"}]},
   {"key":"sum_insured","label":"Benefit amount (GH₵)","type":"currency","required":true,"min":5000,"max":2000000},
   {"key":"age","label":"Your age","type":"number","required":true,"min":18,"max":75},
   {"key":"smoker","label":"Do you smoke?","type":"boolean","required":true},
   {"key":"term_years","label":"Term (years)","type":"number","required":false,"min":1,"max":30},
   {"key":"family_members","label":"Extended family members to include","type":"number","required":false,"min":0,"max":10}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('sme-property', 'Business property & stock', 'Fire, burglary and business-interruption cover for shops, offices and warehouses.',
 'Protect premises, stock and equipment. A business adviser reviews every request before insurers are approached.',
 'store', 'business', 'integrated', 70, 72, '{photo,proof_of_address}', null,
 '[{"key":"business_name","label":"Business name","type":"text","required":true},
   {"key":"business_type","label":"Type of business","type":"text","required":true},
   {"key":"premises_value","label":"Premises value (GH₵)","type":"currency","required":false,"min":0},
   {"key":"stock_value","label":"Stock value (GH₵)","type":"currency","required":true,"min":0},
   {"key":"equipment_value","label":"Equipment value (GH₵)","type":"currency","required":true,"min":0},
   {"key":"business_interruption","label":"Include business interruption?","type":"boolean","required":true},
   {"key":"employees","label":"Number of employees","type":"number","required":true,"min":0},
   {"key":"region","label":"Region","type":"region","required":true}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('liability', 'Professional & public liability', 'Professional indemnity for advisers and public liability for businesses.',
 'Cover claims for negligence, injury to the public and property damage, with clear limits of indemnity.',
 'scale', 'business', 'integrated', 80, 72, '{other}', null,
 '[{"key":"liability_type","label":"Cover needed","type":"select","required":true,"options":[{"value":"professional_indemnity","label":"Professional indemnity"},{"value":"public_liability","label":"Public liability"},{"value":"both","label":"Both"}]},
   {"key":"profession","label":"Profession or trade","type":"text","required":true},
   {"key":"annual_turnover","label":"Annual turnover (GH₵)","type":"currency","required":true,"min":0},
   {"key":"limit_of_indemnity","label":"Limit of indemnity (GH₵)","type":"currency","required":true,"min":50000},
   {"key":"prior_claims","label":"Any claims in the last 5 years?","type":"boolean","required":true}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb),
('marine-cargo', 'Marine cargo & goods in transit', 'Imports, exports and goods moving by road within Ghana.',
 'Cargo cover for importers, exporters and traders, arranged by a specialist marine broker.',
 'ship', 'specialist', 'integrated', 90, 48, '{invoice}', null,
 '[{"key":"transit_type","label":"Shipment","type":"select","required":true,"options":[{"value":"import","label":"Import"},{"value":"export","label":"Export"},{"value":"inland","label":"Inland transit"}]},
   {"key":"goods_description","label":"Goods","type":"text","required":true},
   {"key":"cargo_value","label":"Cargo value (GH₵)","type":"currency","required":true,"min":1000},
   {"key":"conveyance","label":"Conveyance","type":"select","required":true,"options":[{"value":"sea","label":"Sea"},{"value":"air","label":"Air"},{"value":"road","label":"Road"}]},
   {"key":"cover_basis","label":"Cover basis","type":"select","required":true,"options":[{"value":"icc_a","label":"All risks (ICC A)"},{"value":"icc_c","label":"Named perils (ICC C)"}]}]'::jsonb,
 '{"insurer_panel":true,"data_owner":true,"approved_wording":true,"quote_method":true,"payment_route":true,"issuance_process":true,"claims_procedure":true}'::jsonb);

-- Organisations ---------------------------------------------------------------------------
insert into public.organizations (type, status, name, slug, legal_name, description, contact_email, region, settings, brand_color, integration_level, nic_licence_number, nic_licence_class)
values
 ('platform', 'active', 'Insurance Marketplace', 'platform', '[placeholder: technology partner legal entity]',
  'Technology provider. Not an insurer or broker.', 'hello@insurance-marketplace.example', 'Greater Accra', '{"demo": false}', '#00796E', null, null, null),
 ('broker', 'active', 'Demo Broker', 'demo-broker', 'Demo Insurance Brokers Ltd',
  'Primary retail broker of record for personal lines. Human help, when you need it.', 'service@demo-broker.example', 'Greater Accra',
  '{"demo": true, "service_hours": "Mon–Fri 08:00–17:00, Sat 09:00–13:00", "primary_contact": "Kofi Owusu"}', '#00796E', null, 'NIC/DEMO/BRK/001', 'Insurance broker'),
 ('broker', 'active', 'Demo Business Brokers', 'demo-business-brokers', 'Demo Business & Marine Brokers Ltd',
  'Specialist broker for business, liability and marine cargo risks.', 'business@demo-bbrokers.example', 'Greater Accra',
  '{"demo": true, "service_hours": "Mon–Fri 08:30–17:00"}', '#10665E', null, 'NIC/DEMO/BRK/002', 'Insurance broker'),
 ('insurer', 'active', 'Coastline General (Demo)', 'coastline-general', 'Coastline General Insurance Co. (fictional)',
  'Illustrative insurer for demonstration only.', 'partners@coastline.example', 'Greater Accra', '{"demo": true}', '#1F6FB2', 'portal', 'NIC/DEMO/INS/101', 'Non-life'),
 ('insurer', 'active', 'Volta Mutual (Demo)', 'volta-mutual', 'Volta Mutual Assurance (fictional)',
  'Illustrative insurer for demonstration only.', 'partners@voltamutual.example', 'Volta', '{"demo": true}', '#6B3FA0', 'quote_api', 'NIC/DEMO/INS/102', 'Non-life'),
 ('insurer', 'active', 'Ashanti Shield (Demo)', 'ashanti-shield', 'Ashanti Shield Insurance (fictional)',
  'Illustrative insurer for demonstration only.', 'partners@ashantishield.example', 'Ashanti', '{"demo": true}', '#B5651D', 'portal', 'NIC/DEMO/INS/103', 'Non-life'),
 ('insurer', 'active', 'Harmattan Life (Demo)', 'harmattan-life', 'Harmattan Life & Health (fictional)',
  'Illustrative life and health insurer for demonstration only.', 'partners@harmattan.example', 'Greater Accra', '{"demo": true}', '#2E7D32', 'portal', 'NIC/DEMO/INS/201', 'Life');

-- Routing rules: primary retail broker for personal lines; specialist for business/specialist.
insert into public.broker_routing_rules (broker_org_id, category_id, priority, is_secondary)
select b.id, c.id,
  case when (b.slug = 'demo-broker') = (c.segment = 'personal') then 10 else 100 end,
  not ((b.slug = 'demo-broker') = (c.segment = 'personal'))
from public.organizations b cross join public.product_categories c
where b.type = 'broker';

-- Products, versions and appointments ------------------------------------------------------
do $$
declare
  c record; ins record; v_pid uuid; v_vid uuid; v_factor numeric; v_i int; v_rating jsonb; v_cov jsonb; v_lim jsonb; v_exc jsonb; v_excl text[]; v_key text; v_opt jsonb; v_wait int; v_tier text;
  v_insurers text[];
begin
  for c in select * from public.product_categories order by sort_order loop
    if c.slug in ('health', 'life-funeral') then
      v_insurers := array['harmattan-life', 'volta-mutual', 'coastline-general'];
    else
      v_insurers := array['coastline-general', 'volta-mutual', 'ashanti-shield'];
    end if;
    v_i := 0;
    foreach v_key in array v_insurers loop
      v_i := v_i + 1;
      select * into ins from public.organizations where slug = v_key;
      v_factor := case v_i when 1 then 1.00 when 2 then 1.10 else 1.16 end;
      v_tier := case v_i when 1 then 'Standard' when 2 then 'Plus' else 'Premier' end;
      v_wait := 0;
      v_opt := '[]'::jsonb;

      case c.slug
      when 'motor' then
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('vehicle_value'),
          'rate', round(0.040 * v_factor, 4), 'min_premium', round(800 * v_factor),
          'variants', jsonb_build_object('field', 'cover_type', 'factors', jsonb_build_object('comprehensive', 1, 'third_party_fire_theft', 0.45, 'third_party', 0.22)),
          'loadings', jsonb_build_array(
            jsonb_build_object('field', 'use', 'equals', 'commercial', 'factor', 1.30, 'label', 'Commercial use'),
            jsonb_build_object('field', 'driver_age', 'lt', 25, 'factor', 1.20, 'label', 'Young driver'),
            jsonb_build_object('field', 'claims_last_3_years', 'gt', 1, 'factor', 1.25, 'label', 'Claims history')));
        v_cov := '[{"key":"own_damage","label":"Accidental damage to your vehicle","included":true},{"key":"theft","label":"Fire and theft","included":true},{"key":"third_party_injury","label":"Third-party injury","included":true},{"key":"third_party_property","label":"Third-party property damage","included":true},{"key":"windscreen","label":"Windscreen","included":true}]'::jsonb;
        v_lim := jsonb_build_object('vehicle_cover_limit', 'Market value', 'third_party_property', 40000 + (v_i - 1) * 10000, 'windscreen', case v_i when 1 then 2000 when 2 then 3000 else 3500 end);
        v_exc := jsonb_build_object('own_damage', case v_i when 1 then 1000 when 2 then 750 else 500 end, 'windscreen', 0);
        v_excl := array['Commercial use unless declared', 'Unlicensed drivers', 'Driving under the influence', 'Mechanical breakdown'];
        v_opt := '[{"key":"excess_protector","label":"Excess protector","premium":250},{"key":"car_hire","label":"Courtesy car (14 days)","premium":300}]'::jsonb;
      when 'travel' then
        v_rating := jsonb_build_object('model', 'per_day', 'days_field', 'trip_days', 'persons_field', 'travellers',
          'daily_rate', round(9 * v_factor, 2), 'min_premium', round(120 * v_factor),
          'variants', jsonb_build_object('field', 'destination_region', 'factors', jsonb_build_object('africa', 0.8, 'schengen', 1, 'worldwide', 1.7)),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'oldest_traveller_age', 'gt', 65, 'factor', 1.8, 'label', 'Traveller over 65')));
        v_cov := '[{"key":"medical","label":"Emergency medical expenses","included":true},{"key":"evacuation","label":"Medical evacuation & repatriation","included":true},{"key":"cancellation","label":"Trip cancellation","included":true},{"key":"baggage","label":"Lost or delayed baggage","included":true},{"key":"schengen","label":"Meets Schengen visa requirements","included":true}]'::jsonb;
        v_lim := jsonb_build_object('medical', case v_i when 1 then 50000 when 2 then 75000 else 100000 end, 'currency_note', 'EUR equivalent', 'baggage', 1500 * v_i, 'cancellation', 3000 * v_i);
        v_exc := jsonb_build_object('medical', case v_i when 1 then 100 when 2 then 50 else 0 end);
        v_excl := array['Pre-existing medical conditions unless declared', 'Travel against government advice', 'Hazardous sports'];
      when 'personal-accident' then
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('sum_insured'),
          'rate', round(0.006 * v_factor, 5), 'min_premium', round(120 * v_factor),
          'addons', jsonb_build_array(jsonb_build_object('field', 'hospital_cash_daily', 'per_unit_annual', 1.4)),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'occupation_class', 'equals', 'manual', 'factor', 1.5, 'label', 'Manual work'),
                                         jsonb_build_object('field', 'occupation_class', 'equals', 'trade', 'factor', 1.2, 'label', 'Trade work')));
        v_cov := '[{"key":"death","label":"Accidental death","included":true},{"key":"disability","label":"Permanent disability","included":true},{"key":"medical","label":"Accident medical expenses","included":true},{"key":"hospital_cash","label":"Daily hospital cash","included":true}]'::jsonb;
        v_lim := jsonb_build_object('medical_expenses', 5000 * v_i, 'hospital_cash_max_days', 30 + 15 * (v_i - 1));
        v_exc := jsonb_build_object('hospital_cash_deductible_days', case v_i when 1 then 2 when 2 then 1 else 0 end);
        v_excl := array['Self-inflicted injury', 'Injury under the influence of alcohol or drugs', 'Professional sports'];
      when 'home' then
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('building_value', 'contents_value'),
          'rate', round(0.0035 * v_factor, 5), 'min_premium', round(400 * v_factor),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'flood_zone', 'equals', true, 'factor', 1.35, 'label', 'Flood history'),
                                         jsonb_build_object('field', 'construction', 'equals', 'wood', 'factor', 1.4, 'label', 'Wood construction')));
        v_cov := '[{"key":"fire","label":"Fire and lightning","included":true},{"key":"flood","label":"Flood and storm","included":true},{"key":"burglary","label":"Burglary (forced entry)","included":true},{"key":"accidental","label":"Accidental damage","included":false}]'::jsonb;
        v_lim := jsonb_build_object('single_item_limit', 5000 * v_i, 'valuables', 10000 * v_i);
        v_exc := jsonb_build_object('standard', case v_i when 1 then 1000 when 2 then 750 else 500 end, 'flood', 2500);
        v_excl := array['Theft without forced entry', 'Wear and tear', 'Property unoccupied for more than 60 days'];
      when 'health' then
        v_rating := jsonb_build_object('model', 'per_person', 'persons_field', 'members', 'base', round(2400 * v_factor),
          'variants', jsonb_build_object('field', 'plan_level', 'factors', jsonb_build_object('essential', 0.6, 'standard', 1, 'premium', 1.8)),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'oldest_member_age', 'gt', 50, 'factor', 1.6, 'label', 'Age over 50')));
        v_cov := '[{"key":"inpatient","label":"Inpatient care","included":true},{"key":"outpatient","label":"Outpatient care","included":true},{"key":"maternity","label":"Maternity","included":false},{"key":"chronic","label":"Chronic conditions","included":true}]'::jsonb;
        v_lim := jsonb_build_object('annual_limit', 50000 * v_i, 'hospital_network', case v_i when 1 then 'Network A (45 facilities)' when 2 then 'Network B (80 facilities)' else 'Open network' end);
        v_exc := jsonb_build_object('outpatient_copay_percent', case v_i when 1 then 10 when 2 then 5 else 0 end);
        v_excl := array['Cosmetic surgery', 'Fertility treatment', 'Pre-existing conditions during waiting period'];
        v_wait := 90;
      when 'life-funeral' then
        v_rating := jsonb_build_object('model', 'age_banded', 'value_field', 'sum_insured', 'age_field', 'age', 'min_premium', round(60 * v_factor),
          'bands', jsonb_build_array(jsonb_build_object('max_age', 30, 'rate', round(0.004 * v_factor, 5)), jsonb_build_object('max_age', 45, 'rate', round(0.007 * v_factor, 5)),
                                     jsonb_build_object('max_age', 60, 'rate', round(0.014 * v_factor, 5)), jsonb_build_object('max_age', 120, 'rate', round(0.03 * v_factor, 5))),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'smoker', 'equals', true, 'factor', 1.5, 'label', 'Smoker')));
        v_cov := '[{"key":"death","label":"Death from any cause","included":true},{"key":"accidental_death","label":"Accidental death (double benefit)","included":true},{"key":"funeral_payout","label":"Fast funeral payout within 48h","included":true}]'::jsonb;
        v_lim := jsonb_build_object('max_family_members', 6 + v_i);
        v_exc := '{}'::jsonb;
        v_excl := array['Suicide within 12 months', 'Death from undisclosed pre-existing conditions during waiting period'];
        v_wait := case v_i when 1 then 180 when 2 then 120 else 90 end;
      when 'sme-property' then
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('premises_value', 'stock_value', 'equipment_value'),
          'rate', round(0.005 * v_factor, 5), 'min_premium', round(1200 * v_factor),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'business_interruption', 'equals', true, 'factor', 1.25, 'label', 'Business interruption')));
        v_cov := '[{"key":"fire","label":"Fire & allied perils","included":true},{"key":"burglary","label":"Burglary","included":true},{"key":"money","label":"Money in transit","included":true},{"key":"bi","label":"Business interruption","included":false}]'::jsonb;
        v_lim := jsonb_build_object('money_in_transit', 10000 * v_i, 'bi_indemnity_months', 6 * v_i);
        v_exc := jsonb_build_object('standard', 2500 - (v_i - 1) * 500);
        v_excl := array['Stock deterioration', 'Unexplained losses', 'Electrical breakdown'];
      when 'liability' then
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('limit_of_indemnity'),
          'rate', round(0.008 * v_factor, 5), 'min_premium', round(1500 * v_factor),
          'loadings', jsonb_build_array(jsonb_build_object('field', 'prior_claims', 'equals', true, 'factor', 1.4, 'label', 'Prior claims')));
        v_cov := '[{"key":"negligence","label":"Professional negligence","included":true},{"key":"public_injury","label":"Injury to members of the public","included":true},{"key":"defence_costs","label":"Legal defence costs","included":true}]'::jsonb;
        v_lim := jsonb_build_object('defence_costs', 'In addition to limit');
        v_exc := jsonb_build_object('each_claim', 5000 - (v_i - 1) * 1000);
        v_excl := array['Known circumstances before inception', 'Contractual liability', 'Fines and penalties'];
      else -- marine-cargo
        v_rating := jsonb_build_object('model', 'rate_on_value', 'value_fields', jsonb_build_array('cargo_value'),
          'rate', round(0.0025 * v_factor, 5), 'min_premium', round(250 * v_factor),
          'variants', jsonb_build_object('field', 'cover_basis', 'factors', jsonb_build_object('icc_a', 1, 'icc_c', 0.6)));
        v_cov := '[{"key":"all_risks","label":"Loss or damage in transit","included":true},{"key":"general_average","label":"General average & salvage","included":true},{"key":"war_strikes","label":"War & strikes","included":false}]'::jsonb;
        v_lim := jsonb_build_object('basis_of_valuation', 'CIF + 10%');
        v_exc := jsonb_build_object('each_consignment', 0.5 + (3 - v_i) * 0.25, 'unit', 'percent of sum insured');
        v_excl := array['Insufficient packing', 'Inherent vice', 'Delay'];
      end case;

      insert into public.products (insurer_org_id, category_id, name, code, tier, summary, status)
      values (ins.id, c.id, c.name || ' ' || v_tier, upper(replace(c.slug, '-', '_')) || '_' || upper(v_tier), v_tier,
              v_tier || ' ' || lower(c.name) || ' cover from ' || ins.name || '.', 'approved')
      returning id into v_pid;

      insert into public.product_versions (product_id, version, status, coverage, limits, excesses, exclusions, key_exclusion,
        waiting_period_days, optional_benefits, conditions, claims_process, rating, approved_at, insurer_approved_at)
      values (v_pid, 1, 'approved', v_cov, v_lim, v_exc, v_excl, v_excl[1], v_wait, v_opt,
        'Demonstration terms. Full policy wording applies. The broker confirms final quotation.',
        'Notify your broker within 7 days. Upload evidence in the app. The insurer assesses and decides the claim.',
        v_rating, now(), now())
      returning id into v_vid;
      update public.products set current_version_id = v_vid where id = v_pid;

      insert into public.insurer_broker_appointments (insurer_org_id, broker_org_id, category_id, agreement_reference)
      select ins.id, b.id, c.id, 'DEMO-AGREEMENT' from public.organizations b where b.type = 'broker'
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- SaaS plans (indicative; to be agreed in heads of terms) -----------------------------------
insert into public.plans (code, name, audience, description, monthly_fee, included_seats, included_requests, per_request_fee, per_active_policy_fee, features, sort_order) values
 ('broker_pilot', 'Broker Pilot', 'broker', 'Pilot workspace for one broker of record. Indicative pricing, to be agreed.', 0, 5, 100, 0, 0,
  '["Partner workspace & request queue","Customer messaging","Policy wallet servicing","Standard reports"]', 10),
 ('broker_growth', 'Broker Growth', 'broker', 'For brokers scaling digital distribution. Indicative pricing, to be agreed.', 2500, 15, 500, 15, 2,
  '["Everything in Pilot","Multi-team routing & SLAs","Renewal automation","AI assistance for advisers","API access"]', 20),
 ('broker_enterprise', 'Broker Enterprise', 'broker', 'Custom capacity, integrations and support. Indicative pricing, to be agreed.', 7500, null, null, 10, 1.5,
  '["Everything in Growth","Dedicated success manager","Custom integrations","Data export & audit API"]', 30),
 ('insurer_portal', 'Insurer Portal', 'insurer', 'Level-1 partner portal for quotations, issuance and claim status.', 1500, 10, null, 0, 0,
  '["Submission inbox","Quote and policy upload","Claim status updates","Product data management"]', 40),
 ('insurer_connect', 'Insurer Connect', 'insurer', 'Quote API and policy API connectors with monitoring.', 6000, 25, null, 0, 0,
  '["Everything in Portal","Quote API connector","Policy API connector","Webhooks & reconciliation feeds"]', 50),
 ('enterprise_affinity', 'Employer & Affinity', 'enterprise', 'Policy administration for employers and affinity groups.', 3000, 10, null, 0, 1,
  '["Member enrolment","Group policy dashboard","Bulk documents","Usage reporting"]', 60);

insert into public.subscriptions (org_id, plan_id, status, trial_ends_on)
select o.id, p.id, 'trialing', current_date + 60
from public.organizations o join public.plans p
  on (o.type = 'broker' and p.code = 'broker_pilot') or (o.type = 'insurer' and p.code = 'insurer_portal');

-- Flags & settings ---------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description) values
 ('ai_assistant', true, 'Customer & adviser AI assistant (explains, summarises, drafts; never decides suitability).'),
 ('ai_document_extraction', true, 'Extract fields from uploaded documents for adviser review.'),
 ('paid_placements', false, 'Show labelled paid placements, kept separate from suitability ranking.'),
 ('customer_broker_ratings', false, 'Deferred until enough reliable service data exists.'),
 ('whatsapp_channel', false, 'WhatsApp-assisted service (requires legal/operational approval).'),
 ('ussd_channel', false, 'Narrow USSD workflows.'),
 ('demo_mode', true, 'Show "Illustrative only · Demo data" banners and demo partners.'),
 ('self_signup_partners', false, 'Allow brokers/insurers to apply online (admin approval still required).');

insert into public.platform_settings (key, value, description) values
 ('brand', '{"name":"Insurance Marketplace","working_name":true,"tagline":"Insurance made clearer. Human help built in.","support_email":"support@insurance-marketplace.example","support_phone":"[placeholder]"}', 'Brand and contact details'),
 ('disclosure_template', '{"text":"Technology provided by {platform}. Insurance broking services provided by {broker}, NIC licence {broker_licence}. This policy is underwritten and issued by {insurer}."}', 'Mandatory transaction disclosure'),
 ('terms_version', '"2026-10-v1"', 'Current customer terms version'),
 ('privacy_version', '"2026-10-v1"', 'Current privacy notice version'),
 ('complaint_sla_days', '14', 'Days to resolve a complaint before escalation'),
 ('renewal_reminder_days', '[45, 30, 14, 7, 1]', 'Days before expiry to send renewal reminders'),
 ('quote_validity_days', '14', 'Default binding quote validity'),
 ('comparison_engine_version', '"cmp-2026.10"', 'Current comparison/recommendation engine version');
