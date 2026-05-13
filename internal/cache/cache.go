package cache

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"go-callchain-service/internal/model"
)

type Store struct {
	dir string
}

func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

func (s *Store) Dir() string {
	return s.dir
}

func (s *Store) Load(key string) (*model.AnalysisResult, bool, error) {
	dir := filepath.Join(s.dir, key)
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		return s.loadLegacy(key)
	} else if err != nil {
		return nil, false, err
	}

	var result model.AnalysisResult
	if err := readJSON(filepath.Join(dir, "metadata.json"), &result); errors.Is(err, os.ErrNotExist) {
		return s.loadLegacy(key)
	} else if err != nil {
		return nil, false, err
	}
	if err := readJSON(filepath.Join(dir, "functions.json"), &result.Functions); err != nil {
		return nil, false, err
	}
	if err := readJSON(filepath.Join(dir, "edges.json"), &result.Edges); err != nil {
		return nil, false, err
	}
	if err := readJSON(filepath.Join(dir, "routes.json"), &result.Routes); err != nil {
		return nil, false, err
	}
	return &result, true, nil
}

func (s *Store) Save(key string, result *model.AnalysisResult) error {
	dir := filepath.Join(s.dir, key)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	metadata := *result
	metadata.Functions = nil
	metadata.Edges = nil
	metadata.Routes = nil
	if err := writeJSON(filepath.Join(dir, "metadata.json"), metadata); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "functions.json"), result.Functions); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "edges.json"), result.Edges); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "routes.json"), result.Routes); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "line_index.json"), lineIndex(result.Functions)); err != nil {
		return err
	}
	return nil
}

func (s *Store) resultPath(key string) string {
	return filepath.Join(s.dir, key, "result.json")
}

func (s *Store) loadLegacy(key string) (*model.AnalysisResult, bool, error) {
	path := s.resultPath(key)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var result model.AnalysisResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, false, err
	}
	return &result, true, nil
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func lineIndex(functions []model.Function) map[string][]model.Function {
	index := map[string][]model.Function{}
	for _, function := range functions {
		index[function.File] = append(index[function.File], function)
	}
	return index
}
