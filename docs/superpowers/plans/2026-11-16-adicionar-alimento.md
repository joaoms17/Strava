# Adicionar alimento — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Juntar alimentos a uma refeição a partir da própria refeição (mais usados por momento, vários de uma vez, rótulo escrito à mão), escrever gramas ou kcal exatas de cada alimento, e 8 favoritas no ＋.

**Architecture:** Lógica pura nova em `api/_lib/rules/` (partilhada cliente/servidor) e `src/lib/meal-diff.ts`, com testes vitest. O `BarcodeSheet` ganha uma vista de lista («Adicionar alimento») e um modo ligado a uma refeição (`?refeicao=<id>`); o `MealSheet` ganha o botão que o abre. `/api/meal/label` aceita valores escritos em vez de foto.

**Tech Stack:** React 19 + TypeScript, Tailwind 4, Supabase JS, Vercel functions, zod, vitest, knip.

**Spec:** `docs/superpowers/specs/2026-11-16-adicionar-alimento-design.md`

## Global Constraints

- Texto da interface em português de Portugal, no tom das folhas existentes.
- Nada disto chama IA.
- `MealItem` não muda de forma; `/api/meal/update` continua a receber a lista inteira.
- Gramas por item entre 1 e 5 000 (`MAX_ITEM_GRAMS`); arredondamento a 0,1.
- Mais usados: janela de 90 dias, até 30 alimentos.
- Alvos de toque ≥ 44 px (h-11/min-h-11), como no resto da app.
- `npm test` (vitest + knip) e `npm run typecheck` passam no fim de cada tarefa; nada exportado sem uso (knip).

## Review Focus

- Item com `kcal = 0` (água, adoçante) ao escrever kcal: não pode dividir por zero; fica como estava. → teste na Tarefa 1.
- Escrever kcal num item já escalado várias vezes: escala a partir da origem, sem erro acumulado. → teste na Tarefa 1.
- Alimento que aparece duas vezes na mesma refeição, ou item sem `food_id` com nome com acentos/maiúsculas diferentes: conta uma vez por refeição e liga pelo nome normalizado. → testes na Tarefa 2.
- Rótulo escrito com kcal impossíveis (p.ex. 2 000 kcal/100 g, ou proteína > 100 g): recusado com mensagem, nada gravado. → teste na Tarefa 3.
- Cesto antigo (geral) quando se abre a partir de uma refeição: não entra nessa refeição. → verificação manual na Tarefa 5.

---

### Task 1: Escrever kcal (ou gramas) de um alimento da refeição

**Files:**
- Modify: `src/lib/meal-diff.ts`
- Modify: `src/components/ItemList.tsx`
- Test: `tests/meal-diff.test.ts` (criar se não existir; se existir, acrescentar)

**Interfaces:**
- Produces: `setItemKcal(item: MealItem, kcal: number): MealItem` em `src/lib/meal-diff.ts`.

- [ ] **Step 1: Testes que falham**

```ts
import { setItemGrams, setItemKcal } from '../src/lib/meal-diff'
const base = { name: 'Farinha de arroz', grams: 40, kcal: 144, protein: 2.4, carbs: 32, fat: 0.4, food_id: 'f', estimated: true }
it('kcal escritas ajustam as gramas e os macros na mesma proporção', () => {
  const r = setItemKcal(base, 180)
  expect(r.grams).toBe(50); expect(r.kcal).toBe(180); expect(r.carbs).toBe(40); expect(r.estimated).toBe(false)
})
it('escala a partir da origem, sem erro acumulado', () => {
  expect(setItemKcal(setItemGrams(base, 33), 144).grams).toBe(40)
})
it('item sem kcal, sem gramas, ou valor inválido fica igual', () => {
  const zero = { ...base, kcal: 0 }
  expect(setItemKcal(zero, 50)).toBe(zero)
  expect(setItemKcal({ ...base, grams: 0 }, 50).grams).toBe(0)
  expect(setItemKcal(base, 0)).toBe(base); expect(setItemKcal(base, NaN)).toBe(base)
})
it('não passa das 5 000 g', () => { expect(setItemKcal(base, 999999).grams).toBe(5000) })
```

- [ ] **Step 2:** `npx vitest run tests/meal-diff.test.ts` → FAIL (`setItemKcal` não existe).
- [ ] **Step 3: Implementar `setItemKcal`** — usa a origem do `ORIGIN` WeakMap (ou o próprio item); se `origin.kcal <= 0` ou `item.grams <= 0` ou kcal inválida devolve `item`; senão `setItemGrams(item, origin.grams * kcal / origin.kcal)`. (Com o limite de 5 000 g, as kcal ficam as dessas gramas.)
- [ ] **Step 4:** teste passa.
- [ ] **Step 5: ItemList** — na linha não editada, as gramas e as kcal aparecem como duas «caixas» tocáveis (`rounded-md border border-line px-1.5`), substituindo o sublinhado a pontinhos. Tocar nas gramas abre o campo das gramas (comportamento atual); tocar nas kcal abre um campo igual (`aria-label="Kcal de ${name}"`) que chama `setItemKcal`. O estado `editing` ganha `field: 'grams' | 'kcal'`. Esc repõe, Enter/blur fecha, como já faz. Itens com `grams <= 0` continuam só leitura.
- [ ] **Step 6:** `npm test && npm run typecheck` → passa.
- [ ] **Step 7:** commit «Refeição: escrever as kcal de um alimento (ajusta as gramas)».

### Task 2: Mais usados por momento

**Files:**
- Create: `api/_lib/rules/mais-usados.ts`
- Test: `tests/mais-usados.test.ts`

**Interfaces:**
- Consumes: `Slot` (`api/_lib/rules/momentos.ts`), `slotOf`.
- Produces:
  - `type UsedFood<F> = { food: F; grams: number; inSlot: number }`
  - `rankFoodsForSlot<F extends { id: string; name: string; use_count: number; default_portion_g: number | null }>(foods: F[], meals: { slot: Slot | null; logged_at: string; items: { name: string; grams: number; food_id: string | null }[] | null }[], slot: Slot, max = 30): UsedFood<F>[]`
  - `normalizeFoodName(s: string): string` (minúsculas, sem acentos, espaços colapsados, trim).

- [ ] **Step 1: Testes que falham** (`tests/mais-usados.test.ts`):
  - os do momento primeiro, por número de refeições desse momento em que aparecem; empate → `use_count`.
  - restantes depois, por `use_count` desc; `inSlot = 0`.
  - item sem `food_id` liga por nome: `'Farinha de Arróz  prozis'` conta para o alimento `'farinha de arroz Prozis'`.
  - o mesmo alimento duas vezes na mesma refeição conta 1, e as gramas dele nessa refeição somam-se (a mediana é das somas por refeição).
  - `grams` = mediana das gramas por refeição no momento (com [30, 40, 40, 200] → 40; par → média dos dois do meio arredondada a 1 g); sem histórico no momento → `default_portion_g`; sem nada → 100.
  - momento da refeição = `slot ?? slotOf(new Date(logged_at))`.
  - `max` corta a lista.
- [ ] **Step 2:** `npx vitest run tests/mais-usados.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** passa; `npm run typecheck`.
- [ ] **Step 5:** commit «Mais usados: alimentos ordenados pelo que se come em cada momento». (knip pode queixar-se de exports sem uso até à Tarefa 4: correr só vitest aqui e o `npm test` completo na Tarefa 4.)

### Task 3: Rótulo escrito à mão (servidor)

**Files:**
- Modify: `api/_lib/rules/off.ts`
- Modify: `api/_meal/barcode.ts` (`LabelBody`, `label`)
- Test: `tests/rotulo-escrito.test.ts`

**Interfaces:**
- Produces:
  - `type TypedLabel = { name: string; kcal_100g: number; protein_100g: number; carbs_100g?: number | null; fat_100g?: number | null; portion_g?: number | null }`
  - `typedFood(t: TypedLabel): FoodValues | null` em `off.ts` — nome cortado a 120 (vazio → null); kcal 0–900; proteína/hidratos/gordura 0–100 (vazios → 0); soma dos macros ≤ 105; `implausibleItem` como em `labelFood`; extras a null; `default_portion_g = portion_g ?? null`.
  - `POST /api/meal/label` aceita `{ ean, values: TypedLabel }` (sem foto, sem IA, sem limite de IA) além do corpo atual; grava com `saveFood(db, user.id, ean, values, 'user', true)` e responde `{ food }`; valores inválidos → 422 «Esses valores não batem certo. Confirma as kcal e a proteína por 100 g.»

- [ ] **Step 1: Testes que falham** para `typedFood`: valores bons → FoodValues com 0 nos macros vazios; 2 000 kcal → null; proteína 120 → null; nome em branco → null; `'  Bolo  '` → `'Bolo'`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** implementar `typedFood`; `LabelBody` passa a `z.union([fotoBody, z.object({ ean, values: z.object({...}) })])`; no handler, o ramo `values` faz `typedFood` → 422 se null → `saveFood` → 200, antes de qualquer código de foto/IA.
- [ ] **Step 4:** vitest passa; `npm run typecheck`.
- [ ] **Step 5:** commit «Rótulo: escrever os valores à mão quando a foto não dá».

### Task 4: «Adicionar alimento» — lista, mais usados e rótulo escrito

**Files:**
- Modify: `src/components/sheets/BarcodeSheet.tsx`
- Create: `src/components/FoodQuickList.tsx` (lista dos mais usados com filtro)
- Create: `src/components/TypedLabelForm.tsx` (formulário do rótulo)
- Modify: `src/components/sheets/CaptureSheet.tsx` (ícone abre com `ler: '1'`)

**Interfaces:**
- Consumes: `rankFoodsForSlot`, `normalizeFoodName` (Tarefa 2); `TypedLabel`, `/api/meal/label` com `values` (Tarefa 3); `itemOf(food, grams)` já no BarcodeSheet.
- Produces:
  - `FoodQuickList({ slot, onPick }: { slot: Slot; onPick: (food: Food, grams: number) => void })` — carrega `foods` (`order use_count desc, limit 300`) e `meals` (`slot,logged_at,items`, `deleted_at is null`, últimos 90 dias), mostra campo «Procurar nos meus alimentos» (filtro local por `normalizeFoodName`) e a lista `rankFoodsForSlot(...)`: nome, «40 g · 144 kcal», toque → `onPick`.
  - `TypedLabelForm({ ean, onSaved, onCancel }: { ean: string | null; onSaved: (food: Food, grams: number) => void; onCancel: () => void })` — campos: Nome, Kcal /100 g, Proteína /100 g, Hidratos /100 g (opcional), Gordura /100 g (opcional), Gramas comidas; números com `cleanDecimalText`/`decimalFromText` de `lib/campo-numero`. Com `ean` → POST `/api/meal/label { ean, values }`; sem `ean` → valida com `typedFood` e insere em `foods` pelo cliente (`source 'user'`, `use_count 0`). Erro → toast com a mensagem.

- [ ] **Step 1:** BarcodeSheet: título «Adicionar alimento»; `scanning` inicial = `sheet.params.get('ler') === '1' && basket.length === 0`. Sem ler, a vista inicial (sem `food`, `error`, `searching`) mostra: linha de 3 botões «Código» (abre câmara), «Procurar» (pesquisa OFF atual), «Escrever rótulo»; depois `<FoodQuickList slot={…} onPick={(f, g) => { showFood(f); changeGrams(g) }} />`. Momento = `when.slot` se não for `'agora'`, senão `slotOf(new Date())`.
- [ ] **Step 2:** com `food` à vista, o botão principal passa a «＋ Juntar e escolher outro» (`addCurrent()` e volta à lista, sem abrir a câmara); «Ler outro produto» passa a abrir a câmara como hoje.
- [ ] **Step 3:** «Escrever rótulo» abre `TypedLabelForm` com `ean = null`; no erro de código não encontrado (`missing`), além de «Fotografar o rótulo», botão «Escrever os valores» com `ean = missing`. `onSaved` → `showFood(food); changeGrams(grams)`.
- [ ] **Step 4:** CaptureSheet: `open('barras')` → `open('barras', { ler: '1' })` (mantendo os parâmetros de «Quando» que `open` já junta).
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build` → passa.
- [ ] **Step 6:** verificação no browser (Playwright, `npm run dev`, sessão de teste se houver; senão só compilar e rever o JSX): lista aparece, escolher dois alimentos, gravar como refeição nova.
- [ ] **Step 7:** commit «Adicionar alimento: mais usados, vários de uma vez e rótulo escrito».

### Task 5: Ligado a uma refeição + botão «＋ Alimento»

**Files:**
- Modify: `src/lib/barras.ts` (chave por refeição)
- Modify: `src/components/sheets/BarcodeSheet.tsx`
- Modify: `src/components/sheets/MealSheet.tsx` (botão por baixo do `ItemList`, ~linha 773)
- Test: `tests/barras.test.ts`

**Interfaces:**
- Produces: `basketKey(mealId: string | null): string` — `null` → `BASKET_KEY`; id → `${BASKET_KEY}.${mealId}`.

- [ ] **Step 1: Teste que falha:** `basketKey(null) === BASKET_KEY`; `basketKey('abc') === 'regresso.cesto-barras.abc'`.
- [ ] **Step 2:** vitest → FAIL; implementar; passa.
- [ ] **Step 3:** BarcodeSheet lê `refeicao = sheet.params.get('refeicao')`; com ela carrega a refeição (colunas `columns` atuais) e usa `basketKey(refeicao)` para ler/gravar/esquecer o cesto. O rodapé passa a «Juntar N · X kcal» e chama `addTo(meal)` (que já reabre a ficha da refeição e oferece Anular); o «Guardar como nova» e o «Juntar a uma refeição já registada» não aparecem. O momento dos mais usados é `mealSlot(meal)`. O aviso de fechar com cesto reabre com `{ refeicao }`. Se a refeição estiver `a_analisar` ou apagada: mensagem e fecha.
- [ ] **Step 4:** MealSheet: por baixo do `ItemList`, se `current.deleted_at == null` e `current.status !== 'a_analisar'`, botão `min-h-11 w-full rounded-xl border border-line` «＋ Alimento» → `sheet.open('barras', { refeicao: current.id })`. Alterações por guardar na ficha (`items` ≠ guardados): perguntar antes ou guardar primeiro — usar o mesmo aviso que a ficha já usa ao fechar com alterações, se existir; senão, desativar o botão com a dica «Guarda as alterações primeiro».
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build`.
- [ ] **Step 6:** verificação: abrir uma refeição → ＋ Alimento → escolher 2 → Juntar → volta à ficha com os 4 itens e totais certos; Anular repõe. Com um cesto geral guardado antes, ele não aparece aqui.
- [ ] **Step 7:** commit «Refeição: ＋ Alimento junta diretamente a ela».

### Task 6: 8 favoritas no ＋

**Files:**
- Modify: `src/components/sheets/CaptureSheet.tsx:54`

- [ ] **Step 1:** `QUICK_FAVORITES = 8`. A grelha é `grid-cols-2`: 4 linhas, sem outra mudança.
- [ ] **Step 2:** `npm test && npm run typecheck`.
- [ ] **Step 3:** commit «＋: 8 favoritas em vez de 4».
