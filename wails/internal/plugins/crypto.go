package plugins

// require('crypto') dos plugins: o que costuma aparecer em plugins de auth (hash, HMAC, aleatórios)

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"fmt"
	"hash"
	"strings"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
)

func newHash(vm *goja.Runtime, alg string) func() hash.Hash {
	switch strings.ToLower(strings.ReplaceAll(alg, "-", "")) {
	case "md5":
		return md5.New
	case "sha1":
		return sha1.New
	case "sha256":
		return sha256.New
	case "sha384":
		return sha512.New384
	case "sha512":
		return sha512.New
	}
	panic(vm.NewGoError(fmt.Errorf("algoritmo %q não suportado", alg)))
}

// objeto com update/digest em cima de um hash.Hash
func hashObject(vm *goja.Runtime, h hash.Hash) *goja.Object {
	o := vm.NewObject()
	_ = o.Set("update", func(c goja.FunctionCall) goja.Value {
		h.Write(buffer.DecodeBytes(vm, c.Argument(0), c.Argument(1)))
		return o
	})
	_ = o.Set("digest", func(c goja.FunctionCall) goja.Value {
		sum := h.Sum(nil)
		enc := c.Argument(0)
		if goja.IsUndefined(enc) {
			return buffer.WrapBytes(vm, sum)
		}
		return buffer.EncodeBytes(vm, sum, enc)
	})
	return o
}

func cryptoModule(vm *goja.Runtime) goja.Value {
	m := vm.NewObject()
	_ = m.Set("createHash", func(c goja.FunctionCall) goja.Value {
		return hashObject(vm, newHash(vm, c.Argument(0).String())())
	})
	_ = m.Set("createHmac", func(c goja.FunctionCall) goja.Value {
		key := buffer.DecodeBytes(vm, c.Argument(1), goja.Undefined())
		return hashObject(vm, hmac.New(newHash(vm, c.Argument(0).String()), key))
	})
	_ = m.Set("randomBytes", func(c goja.FunctionCall) goja.Value {
		b := make([]byte, c.Argument(0).ToInteger())
		_, _ = rand.Read(b)
		return buffer.WrapBytes(vm, b)
	})
	_ = m.Set("randomUUID", func(goja.FunctionCall) goja.Value {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		b[6] = b[6]&0x0f | 0x40
		b[8] = b[8]&0x3f | 0x80
		return vm.ToValue(fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]))
	})
	_ = m.Set("timingSafeEqual", func(c goja.FunctionCall) goja.Value {
		a := buffer.Bytes(vm, c.Argument(0))
		b := buffer.Bytes(vm, c.Argument(1))
		return vm.ToValue(len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1)
	})
	return m
}
