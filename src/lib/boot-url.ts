// O endereço com que a app abriu, lido antes de o supabase-js o limpar: o
// link de recuperação da palavra-passe traz a sessão (ou o erro, se expirou)
// no #hash, e o supabase-js apaga-o depois de o ler.
const hash = new URLSearchParams(window.location.hash.slice(1))
const query = new URLSearchParams(window.location.search)
const get = (name: string) => hash.get(name) ?? query.get(name)

export const RECOVERY_PATH = '/nova-passe'

export const bootUrl = {
  recovery: window.location.pathname === RECOVERY_PATH || get('type') === 'recovery',
  errorCode: get('error_code'),
  error: get('error_description') ?? get('error'),
}
