# Plano de 4 semanas (arquivado na Fase 5)

O plano de ginásio gerado pela IA, o calendário ICS e o emparelhamento dos
treinos com as sessões planeadas saíram da app na Fase 5 do redesenho: o
ginásio passou a ser livre (Sessão de ginásio, com as cargas da última vez e
os favoritos «Pernas A» e «Corpo todo B»). Os dados ficam no Supabase
(`plan_blocks`, `planned_sessions`) e continuam visíveis em Definições ›
Arquivo. Estes ficheiros ficam aqui só para consulta: estão fora de `api/`,
do `tsconfig` e do vitest, por isso não fazem deploy nem typecheck.
