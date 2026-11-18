// {% faker 'randomEmail' %}: dados falsos com os nomes do Insomnia/Postman ($randomEmail…), sem dependência.

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]
const int = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min
const hex = (n: number): string => Array.from({ length: n }, () => int(0, 15).toString(16)).join('')
const alnum = (n: number): string => Array.from({ length: n }, () => pick([...'abcdefghijklmnopqrstuvwxyz0123456789'])).join('')

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Tiago', 'Vitória', 'William']
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa']
const CITY = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife', 'Salvador', 'Fortaleza', 'Joinville', 'Florianópolis']
const COUNTRY = ['Brasil', 'Argentina', 'Portugal', 'Chile', 'Uruguai', 'México', 'Espanha', 'Canadá', 'Japão', 'Alemanha']
const STREET = ['Rua das Flores', 'Avenida Paulista', 'Rua XV de Novembro', 'Avenida Brasil', 'Rua da Consolação', 'Rua Augusta']
const COMPANY = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Hooli', 'Vandelay']
const JOB = ['Desenvolvedor', 'Analista de dados', 'Gerente de produto', 'Designer', 'Engenheiro de software', 'Arquiteto de soluções']
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore', 'magna']
const DOMAIN = ['exemplo.com', 'teste.dev', 'mail.local', 'empresa.com.br']
const COLOR = ['vermelho', 'azul', 'verde', 'amarelo', 'roxo', 'laranja', 'preto', 'branco']

const slug = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '.')
const words = (n: number): string => Array.from({ length: n }, () => pick(WORDS)).join(' ')
const sentence = (): string => {
  const w = words(int(6, 12))
  return `${w[0].toUpperCase()}${w.slice(1)}.`
}
const uuid = (): string => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`
const day = (dir: 1 | -1): string => new Date(Date.now() + dir * int(1, 365) * 86_400_000).toISOString()

export const FAKER: Record<string, { label: string; gen: () => string }> = {
  randomUUID: { label: 'UUID', gen: uuid },
  randomFirstName: { label: 'Nome', gen: () => pick(FIRST) },
  randomLastName: { label: 'Sobrenome', gen: () => pick(LAST) },
  randomFullName: { label: 'Nome completo', gen: () => `${pick(FIRST)} ${pick(LAST)}` },
  randomUserName: { label: 'Usuário', gen: () => `${slug(pick(FIRST))}${int(1, 999)}` },
  randomEmail: { label: 'E-mail', gen: () => `${slug(pick(FIRST))}.${slug(pick(LAST))}${int(1, 99)}@${pick(DOMAIN)}` },
  randomPassword: { label: 'Senha', gen: () => `${alnum(10)}${pick(['!', '#', '@', '$'])}${int(10, 99)}` },
  randomPhoneNumber: { label: 'Telefone', gen: () => `(${int(11, 99)}) 9${int(1000, 9999)}-${int(1000, 9999)}` },
  randomInt: { label: 'Inteiro (0–1000)', gen: () => String(int(0, 1000)) },
  randomBoolean: { label: 'Booleano', gen: () => String(Math.random() < 0.5) },
  randomPrice: { label: 'Preço', gen: () => (int(100, 99999) / 100).toFixed(2) },
  randomAlphaNumeric: { label: 'Caractere alfanumérico', gen: () => alnum(1) },
  randomCity: { label: 'Cidade', gen: () => pick(CITY) },
  randomCountry: { label: 'País', gen: () => pick(COUNTRY) },
  randomStreetAddress: { label: 'Endereço', gen: () => `${pick(STREET)}, ${int(1, 3000)}` },
  randomCompanyName: { label: 'Empresa', gen: () => `${pick(COMPANY)} ${pick(['Ltda', 'S.A.', 'Tecnologia', 'Digital'])}` },
  randomJobTitle: { label: 'Cargo', gen: () => pick(JOB) },
  randomWord: { label: 'Palavra', gen: () => pick(WORDS) },
  randomWords: { label: 'Palavras', gen: () => words(int(2, 5)) },
  randomLoremSentence: { label: 'Frase', gen: sentence },
  randomLoremParagraph: { label: 'Parágrafo', gen: () => Array.from({ length: int(3, 5) }, sentence).join(' ') },
  randomColor: { label: 'Cor', gen: () => pick(COLOR) },
  randomHexColor: { label: 'Cor hex', gen: () => `#${hex(6)}` },
  randomIP: { label: 'IPv4', gen: () => `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}` },
  randomUrl: { label: 'URL', gen: () => `https://${pick(['www', 'api', 'app'])}.${pick(DOMAIN)}/${pick(WORDS)}` },
  randomDatePast: { label: 'Data passada', gen: () => day(-1) },
  randomDateFuture: { label: 'Data futura', gen: () => day(1) },
  randomCPF: { label: 'CPF (válido)', gen: cpf },
  timestamp: { label: 'Timestamp unix', gen: () => String(Math.floor(Date.now() / 1000)) },
  isoTimestamp: { label: 'Data ISO', gen: () => new Date().toISOString() }
}

/** CPF com dígitos verificadores válidos (só pra teste) */
function cpf(): string {
  const n = Array.from({ length: 9 }, () => int(0, 9))
  const dv = (base: number[]): number => {
    const s = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0) % 11
    return s < 2 ? 0 : 11 - s
  }
  n.push(dv(n))
  n.push(dv(n))
  return `${n.slice(0, 3).join('')}.${n.slice(3, 6).join('')}.${n.slice(6, 9).join('')}-${n.slice(9).join('')}`
}

export function fake(name: string): string {
  const f = FAKER[name.replace(/^\$/, '')]
  if (!f) throw new Error(`faker "${name}" não existe (ex.: randomEmail, randomFullName, randomUUID)`)
  return f.gen()
}
