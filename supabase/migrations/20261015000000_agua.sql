-- Migração 12: água do dia (Hoje › Água), em ml. O fecho do dia não lhe mexe.
alter table public.days add column if not exists water_ml integer not null default 0
  check (water_ml >= 0 and water_ml <= 10000);
