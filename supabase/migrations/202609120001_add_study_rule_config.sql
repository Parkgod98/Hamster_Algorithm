alter table public.hamster_studies
add column if not exists rule_config jsonb not null default '{
  "bojBronzeCount": 3,
  "bojSilverCount": 2,
  "bojGoldCount": 1,
  "programmersLowCount": 3,
  "programmersHighCount": 1,
  "sweaLowCount": 2,
  "sweaHighCount": 1,
  "codetreeSamsungCount": 1,
  "penalties": {"1": 10000, "2": 25000, "3": 50000}
}'::jsonb;

alter table public.hamster_studies
add constraint hamster_studies_rule_config_object_check
check (jsonb_typeof(rule_config) = 'object');
