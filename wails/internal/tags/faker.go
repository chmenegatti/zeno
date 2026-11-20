package tags

// {% faker 'randomEmail' %}: dados falsos com os nomes do Insomnia/Postman (port de src/shared/faker.ts)

import (
	"fmt"
	"math/rand/v2"
	"regexp"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

func pick(a []string) string { return a[rand.IntN(len(a))] }
func rint(min, max int) int  { return rand.IntN(max-min+1) + min }
func hexs(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "%x", rint(0, 15))
	}
	return b.String()
}
func alnum(n int) string {
	const c = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = c[rand.IntN(len(c))]
	}
	return string(b)
}

var (
	first   = []string{"Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Hugo", "Isabela", "João", "Larissa", "Marcos", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Tiago", "Vitória", "William"}
	last    = []string{"Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Ribeiro", "Carvalho", "Gomes", "Martins", "Rocha", "Barbosa"}
	city    = []string{"São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre", "Recife", "Salvador", "Fortaleza", "Joinville", "Florianópolis"}
	country = []string{"Brasil", "Argentina", "Portugal", "Chile", "Uruguai", "México", "Espanha", "Canadá", "Japão", "Alemanha"}
	street  = []string{"Rua das Flores", "Avenida Paulista", "Rua XV de Novembro", "Avenida Brasil", "Rua da Consolação", "Rua Augusta"}
	company = []string{"Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay"}
	job     = []string{"Desenvolvedor", "Analista de dados", "Gerente de produto", "Designer", "Engenheiro de software", "Arquiteto de soluções"}
	wordsL  = []string{"lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "labore", "magna"}
	domain  = []string{"exemplo.com", "teste.dev", "mail.local", "empresa.com.br"}
	color   = []string{"vermelho", "azul", "verde", "amarelo", "roxo", "laranja", "preto", "branco"}
	nonAZ   = regexp.MustCompile(`[^a-z0-9]+`)
)

func slugName(s string) string {
	t := strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, norm.NFD.String(s))
	return nonAZ.ReplaceAllString(strings.ToLower(t), ".")
}

func words(n int) string {
	w := make([]string, n)
	for i := range w {
		w[i] = pick(wordsL)
	}
	return strings.Join(w, " ")
}

func sentence() string {
	w := words(rint(6, 12))
	return strings.ToUpper(w[:1]) + w[1:] + "."
}

func isoNow(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func day(dir int) string {
	return isoNow(time.Now().Add(time.Duration(dir*rint(1, 365)) * 24 * time.Hour))
}

// CPF com dígitos verificadores válidos (só pra teste)
func cpf() string {
	n := make([]int, 9, 11)
	for i := range n {
		n[i] = rint(0, 9)
	}
	dv := func(base []int) int {
		s := 0
		for i, d := range base {
			s += d * (len(base) + 1 - i)
		}
		s %= 11
		if s < 2 {
			return 0
		}
		return 11 - s
	}
	n = append(n, dv(n))
	n = append(n, dv(n))
	d := func(a []int) string {
		var b strings.Builder
		for _, x := range a {
			fmt.Fprint(&b, x)
		}
		return b.String()
	}
	return d(n[0:3]) + "." + d(n[3:6]) + "." + d(n[6:9]) + "-" + d(n[9:])
}

// Faker: nome → gerador (mesmos nomes e rótulos do Electron)
var Faker = map[string]func() string{
	"randomUUID": func() string {
		return hexs(8) + "-" + hexs(4) + "-4" + hexs(3) + "-" + pick([]string{"8", "9", "a", "b"}) + hexs(3) + "-" + hexs(12)
	},
	"randomFirstName": func() string { return pick(first) },
	"randomLastName":  func() string { return pick(last) },
	"randomFullName":  func() string { return pick(first) + " " + pick(last) },
	"randomUserName":  func() string { return fmt.Sprintf("%s%d", slugName(pick(first)), rint(1, 999)) },
	"randomEmail": func() string {
		return fmt.Sprintf("%s.%s%d@%s", slugName(pick(first)), slugName(pick(last)), rint(1, 99), pick(domain))
	},
	"randomPassword": func() string {
		return fmt.Sprintf("%s%s%d", alnum(10), pick([]string{"!", "#", "@", "$"}), rint(10, 99))
	},
	"randomPhoneNumber":   func() string { return fmt.Sprintf("(%d) 9%d-%d", rint(11, 99), rint(1000, 9999), rint(1000, 9999)) },
	"randomInt":           func() string { return fmt.Sprint(rint(0, 1000)) },
	"randomBoolean":       func() string { return fmt.Sprint(rand.Float64() < 0.5) },
	"randomPrice":         func() string { return fmt.Sprintf("%.2f", float64(rint(100, 99999))/100) },
	"randomAlphaNumeric":  func() string { return alnum(1) },
	"randomCity":          func() string { return pick(city) },
	"randomCountry":       func() string { return pick(country) },
	"randomStreetAddress": func() string { return fmt.Sprintf("%s, %d", pick(street), rint(1, 3000)) },
	"randomCompanyName":   func() string { return pick(company) + " " + pick([]string{"Ltda", "S.A.", "Tecnologia", "Digital"}) },
	"randomJobTitle":      func() string { return pick(job) },
	"randomWord":          func() string { return pick(wordsL) },
	"randomWords":         func() string { return words(rint(2, 5)) },
	"randomLoremSentence": sentence,
	"randomLoremParagraph": func() string {
		s := make([]string, rint(3, 5))
		for i := range s {
			s[i] = sentence()
		}
		return strings.Join(s, " ")
	},
	"randomColor":    func() string { return pick(color) },
	"randomHexColor": func() string { return "#" + hexs(6) },
	"randomIP": func() string {
		return fmt.Sprintf("%d.%d.%d.%d", rint(1, 254), rint(0, 255), rint(0, 255), rint(1, 254))
	},
	"randomUrl": func() string {
		return fmt.Sprintf("https://%s.%s/%s", pick([]string{"www", "api", "app"}), pick(domain), pick(wordsL))
	},
	"randomDatePast":   func() string { return day(-1) },
	"randomDateFuture": func() string { return day(1) },
	"randomCPF":        cpf,
	"timestamp":        func() string { return fmt.Sprint(time.Now().Unix()) },
	"isoTimestamp":     func() string { return isoNow(time.Now()) },
}

// Fake gera o dado (aceita $randomEmail)
func Fake(name string) (string, error) {
	f, ok := Faker[strings.TrimPrefix(name, "$")]
	if !ok {
		return "", fmt.Errorf("faker %q não existe (ex.: randomEmail, randomFullName, randomUUID)", name)
	}
	return f(), nil
}
