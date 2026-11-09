-- Phase 14 (seed rates, section 3): every row below is flagged needs_review. The lives are the ones the spec names; the
-- accounts are the chart's existing asset / accumulated depreciation accounts. IT-Act rates are seeded ONLY for the four blocks
-- the spec names (P&M 15 %, computers 40 %, furniture 10 %, buildings 10 %); the others are the owner's to add. Forward-only.

INSERT INTO "asset_categories" ("code","name","asset_class","asset_account","accum_dep_account","expense_account","cwip_account","itc_eligible","is_maintainable_default","nesd","it_block_code") VALUES
 ('BLD_FACTORY','Factory building','BUILDING','1602','1702','6241','1650',true,false,false,'BUILDING'),
 ('BLD_RCC','RCC building (non-factory)','BUILDING','1602','1702','6241','1650',true,false,false,'BUILDING'),
 ('PM_GENERAL','Plant and machinery (general)','PM','1603','1703','6241','1650',true,true,false,'PM'),
 ('PM_CONTINUOUS','Plant and machinery (continuous process)','PM','1603','1703','6241','1650',true,true,false,'PM'),
 ('COMPUTER','Computers and laptops','COMPUTER','1607','1707','6241','1650',true,false,false,'COMPUTER'),
 ('SERVER_NET','Servers and networks','COMPUTER','1607','1707','6241','1650',true,false,false,'COMPUTER'),
 ('FURNITURE','Furniture and fittings','FURNITURE','1604','1704','6241','1650',true,false,false,'FURNITURE'),
 ('OFFICE_EQUIP','Office equipment','OFFICE_EQUIP','1606','1706','6241','1650',true,false,false,NULL),
 ('ELECTRICAL','Electrical installations','ELECTRICAL','1608','1708','6241','1650',true,true,false,NULL),
 ('CAR','Motor car','VEHICLE','1605','1705','6241','1650',false,true,false,NULL),
 ('TWO_WHEELER','Two-wheeler','VEHICLE','1605','1705','6241','1650',false,true,false,NULL),
 ('HEAVY_VEHICLE','Heavy vehicle','VEHICLE','1605','1705','6241','1650',true,true,false,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "asset_category_book_params" ("category_id","effective_from","method","useful_life_months","residual_pct","sch2_ref")
SELECT c."id", DATE '2014-04-01', 'SLM', v.months, 5, 'Companies Act 2013 Sch II Part C'
  FROM "asset_categories" c JOIN (VALUES
    ('BLD_FACTORY',360),('BLD_RCC',720),('PM_GENERAL',180),('PM_CONTINUOUS',300),('COMPUTER',36),('SERVER_NET',72),
    ('FURNITURE',120),('OFFICE_EQUIP',60),('ELECTRICAL',120),('CAR',96),('TWO_WHEELER',120),('HEAVY_VEHICLE',96)
  ) AS v(code, months) ON v.code = c."code"
ON CONFLICT DO NOTHING;

INSERT INTO "it_blocks" ("code","name","act_ref") VALUES
 ('PM','Plant and machinery (general)','ITA1961 s.32'),
 ('COMPUTER','Computers including software','ITA1961 s.32'),
 ('FURNITURE','Furniture and fittings','ITA1961 s.32'),
 ('BUILDING','Buildings (general)','ITA1961 s.32')
ON CONFLICT DO NOTHING;
INSERT INTO "it_block_rates" ("block_id","effective_from","rate_pct","half_rate_rule","act_ref")
SELECT b."id", d.eff, v.rate, true, d.ref
  FROM "it_blocks" b JOIN (VALUES ('PM',15),('COMPUTER',40),('FURNITURE',10),('BUILDING',10)) AS v(code, rate) ON v.code = b."code"
  CROSS JOIN (VALUES (DATE '2014-04-01','ITA1961 s.32'), (DATE '2026-04-01','ITA2025')) AS d(eff, ref)
ON CONFLICT DO NOTHING;

-- ISO 14224-style starter codes (the plant's own list replaces them)
INSERT INTO "failure_codes" ("kind","code","name") VALUES
 ('MODE','FTS','Fails to start'),('MODE','STP','Fails to stop'),('MODE','OHE','Overheating'),('MODE','VIB','Vibration'),
 ('MODE','LOO','Low output'),('MODE','ELP','External leakage'),('MODE','NOI','Abnormal noise'),('MODE','ERO','Erratic output'),
 ('MODE','STD','Structural damage'),('MODE','OTH','Other'),
 ('CAUSE','WEAR','Wear and ageing'),('CAUSE','LUB','Lubrication failure'),('CAUSE','OPS','Operating error'),
 ('CAUSE','MNT','Maintenance error'),('CAUSE','DES','Design or material'),('CAUSE','EXT','External cause (power, dust, water)'),
 ('MECHANISM','MECH','Mechanical'),('MECHANISM','ELEC','Electrical'),('MECHANISM','INST','Instrument or control'),
 ('MECHANISM','HYD','Hydraulic or pneumatic'),('MECHANISM','MATL','Material')
ON CONFLICT DO NOTHING;

INSERT INTO "alert_rules" ("alert_type","lead_days","escalation_minutes","channel") VALUES
 ('PM_DUE',3,'{}','IN_APP'),
 ('PM_OVERDUE',0,'{1440,4320}','IN_APP'),
 ('BREAKDOWN_UNACK',0,'{30,120}','IN_APP'),
 ('WARRANTY_EXPIRY',30,'{}','IN_APP'),
 ('SPARE_LOW',0,'{}','IN_APP'),
 ('LOAN_RETURN_DUE',2,'{}','IN_APP')
ON CONFLICT DO NOTHING;
