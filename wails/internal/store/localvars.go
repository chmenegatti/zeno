package store

// Valores locais de variáveis (#153): ficam num arquivo da pasta de dados do app, fora das pastas dos
// workspaces, e nunca vão pro git, pro export nem pro "Salvar no GitHub". Formato:
//
//	<id do workspace>:
//	  <id do ambiente>:   # Base (vale em todos) ou um sub-ambiente
//	    nome: valor       # valor pode ser um token do cofre
//
// Ao carregar, cada workspace recebe o campo transitório localVars (mesmo formato, só dele).

import (
	"path/filepath"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

const localVarsFile = "local-vars.yaml"

func (s *Store) localVarsPath() string { return filepath.Join(s.Dir, localVarsFile) }

func (s *Store) readLocalVars() *Doc {
	if d := readYaml(s.localVarsPath()); d != nil {
		return d
	}
	return doc.New()
}

// SetLocalVar grava (value != nil) ou apaga (value == nil) o valor local de name no ambiente envID
func (s *Store) SetLocalVar(wsID, envID, name string, value any) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.readLocalVars()
	ws := all.Map(wsID)
	if ws == nil {
		ws = doc.New()
	}
	env := ws.Map(envID)
	if env == nil {
		env = doc.New()
	}
	if value == nil {
		env.Del(name)
	} else {
		env.Set(name, value)
	}
	if env.Len() > 0 {
		ws.Set(envID, env)
	} else {
		ws.Del(envID)
	}
	if ws.Len() > 0 {
		all.Set(wsID, ws)
	} else {
		all.Del(wsID)
	}
	// só agora: abrir uma pasta de dados antiga não muda o .gitignore
	writeGitignore(s.Dir, localVarsFile)
	if err := s.write(s.localVarsPath(), all); err != nil {
		return nil, err
	}
	return s.load(), nil
}
