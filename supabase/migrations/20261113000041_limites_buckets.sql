-- G5 (auditoria 2026-11): os buckets passam a ter limite de tamanho e de tipo
-- de ficheiro. O que a app envia hoje (src/lib/image.ts):
--   meal-photos    — fotos das refeições, favoritas, sobras, menu e rótulo:
--                    JPEG de 1024 px (~150 kB), 1568 px nas refeições com
--                    várias fotos, até 2048 px nas capturas de ecrã e nos
--                    menus (encolhidas até ~1,4 MB), miniaturas de 256 px.
--                    Em produção: média de 123 kB.
--   workout-shots  — prints do relógio em JPEG até 2576 px (q0,9) e
--                    miniaturas; o servidor também lê .png e .webp.
--   chapter-photos — fotos dos capítulos (Arquivo, bucket público): JPEG de
--                    1600 px; se o telemóvel não as converter, vai o original.
-- O áudio do «Dizer o treino» não passa pelo Storage (vai no pedido, em WAV).
-- Os limites ficam folgados (3 a 4 vezes o maior ficheiro esperado) para
-- nenhuma foto legítima falhar; só se aplicam a envios novos.

update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'meal-photos';

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'workout-shots';

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'chapter-photos';
