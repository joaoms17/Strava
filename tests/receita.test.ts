import { describe, expect, it } from 'vitest'
import {
  charsetOf,
  checkRecipeUrl,
  decodeEntities,
  extractRecipe,
  isPublicAddress,
  pageTitle,
  parseServings,
  visibleText,
} from '../api/_lib/rules/receita'

// Importar uma receita: o servidor só lê páginas públicas e tira os
// ingredientes do schema.org Recipe (JSON-LD), ou do texto visível.
describe('endereços públicos', () => {
  it('recusa a rede local, o loopback, o link-local e os reservados', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
      '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
      '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::1', 'not-an-ip', '1.2.3', '1.2.3.256',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('aceita a internet pública', () => {
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '193.136.1.1', '2a00:1450:4003:80e::200e', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })

  it('o link: só https, sem credenciais, na porta normal e com domínio público', () => {
    expect(checkRecipeUrl('https://www.pingodoce.pt/receitas/arroz-de-pato/#topo')).toEqual({
      url: new URL('https://www.pingodoce.pt/receitas/arroz-de-pato/'),
    })
    expect(checkRecipeUrl('http://www.pingodoce.pt/receita')).toEqual({ error: 'O link tem de começar por https://.' })
    expect(checkRecipeUrl('ftp://x.pt')).toHaveProperty('error')
    expect(checkRecipeUrl('https://user:pass@site.pt/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://site.pt:8443/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://localhost/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://router.local/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://intranet/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://127.0.0.1/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://2130706433/')).toHaveProperty('error') // 127.0.0.1 por extenso
    expect(checkRecipeUrl('https://[::1]/')).toHaveProperty('error')
    expect(checkRecipeUrl('https://169.254.169.254/latest/meta-data')).toHaveProperty('error')
    expect(checkRecipeUrl('não é um link')).toHaveProperty('error')
  })
})

describe('schema.org Recipe', () => {
  const page = (json: string) => `<html><head><title>Arroz &amp; pato</title>
    <script type="application/ld+json">${json}</script></head><body></body></html>`

  it('lê os ingredientes, as doses e a nutrição, dentro de @graph', () => {
    const html = page(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: 'Página' },
          {
            '@type': ['Recipe'],
            name: 'Arroz de Pato &amp; Chouriço',
            recipeYield: ['4', '4 doses'],
            recipeIngredient: ['1 pato (cerca de 2 kg)', '<b>300 g</b> de arroz carolino', '  ', '1 chouriço'],
            nutrition: { '@type': 'NutritionInformation', calories: '650 kcal', proteinContent: '38 g' },
          },
        ],
      }),
    )
    expect(extractRecipe(html)).toEqual({
      name: 'Arroz de Pato & Chouriço',
      ingredients: ['1 pato (cerca de 2 kg)', '300 g de arroz carolino', '1 chouriço'],
      servings: 4,
      nutrition: { calories: '650 kcal', proteinContent: '38 g' },
    })
  })

  it('aguenta JSON com mudanças de linha cruas e ignora blocos sem receita', () => {
    const html =
      page('{"@type":"Organization","name":"Site"}') +
      page('{"@type":"Recipe","name":"Sopa","recipeYield":"Para 6 pessoas","recipeIngredient":["2 cenouras",\n"1 alho-francês"]}'.replace('Sopa', 'Sopa\nde legumes'))
    expect(extractRecipe(html)).toMatchObject({ name: 'Sopa de legumes', servings: 6, ingredients: ['2 cenouras', '1 alho-francês'] })
  })

  it('sem Recipe com ingredientes: null', () => {
    expect(extractRecipe(page('{"@type":"Recipe","name":"Vazia"}'))).toBeNull()
    expect(extractRecipe('<html><body>sem nada</body></html>')).toBeNull()
    expect(extractRecipe(page('{ partido'))).toBeNull()
  })

  it('doses: o primeiro número entre 1 e 30', () => {
    expect(parseServings('6 porções')).toBe(6)
    expect(parseServings(['x', '8'])).toBe(8)
    expect(parseServings(2)).toBe(2)
    expect(parseServings('0')).toBeNull()
    expect(parseServings('100 g')).toBeNull()
    expect(parseServings(null)).toBeNull()
  })
})

describe('texto da página', () => {
  it('tira scripts, estilos e menus e começa perto dos ingredientes', () => {
    const html = `<html><head><style>.x{}</style></head><body><nav>Início · Receitas</nav>
      <p>${'Uma história muito comprida sobre a avó. '.repeat(20)}</p>
      <h2>Ingredientes</h2><ul><li>2 ovos</li><li>100&nbsp;g de farinha</li></ul>
      <script>var x = 1</script><footer>© site</footer></body></html>`
    const text = visibleText(html)
    expect(text).toContain('Ingredientes\n2 ovos\n100 g de farinha')
    expect(text).not.toContain('var x')
    expect(text).not.toContain('Início')
    expect(text).not.toContain('© site')
    expect(text.length).toBeLessThan(500)
    expect(visibleText(html, 20)).toHaveLength(20)
  })

  it('título, entidades e charset', () => {
    expect(pageTitle('<meta property="og:title" content="Bacalhau à Brás"><title>X</title>')).toBe('Bacalhau à Brás')
    expect(pageTitle('<title>Feijoada &amp; arroz</title>')).toBe('Feijoada & arroz')
    expect(decodeEntities('P&atilde;o &Ccedil; &#233; &#xE7; &frac12; &bogus;')).toBe('Pão Ç é ç ½ &bogus;')
    expect(charsetOf('text/html; charset=ISO-8859-1', '')).toBe('iso-8859-1')
    expect(charsetOf(null, '<meta charset="windows-1252">')).toBe('windows-1252')
    expect(charsetOf('text/html', '')).toBe('utf-8')
  })
})
