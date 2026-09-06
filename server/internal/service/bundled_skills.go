package service

// Loading a skill bundle that ships with the server binary.
//
// Two bundles use this: the SDLC delivery system, whose skills are authored
// here, and Ontologizer, whose skills are authored in their own repository and
// vendored in by scripts/sync-ontologizer-skills.sh. Both are provisioned into
// the catalog workspace and published to the Marketplace from there, so both
// need the same thing — an embedded directory tree turned into skill rows.

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"gopkg.in/yaml.v3"
)

// loadBundledSkills reads every skill directory under root. A skill is one
// directory holding SKILL.md plus whatever reference and template files it
// ships; the directory name is the skill name, and namePrefix is prepended when
// the bundle's skills live in an invocation-key namespace ("ontologizer:").
func loadBundledSkills(fsys fs.FS, root, namePrefix string) ([]AgentSkillData, error) {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return nil, err
	}
	skills := make([]AgentSkillData, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := path.Join(root, entry.Name())
		content, err := fs.ReadFile(fsys, path.Join(dir, "SKILL.md"))
		if err != nil {
			return nil, fmt.Errorf("load %s/SKILL.md: %w", entry.Name(), err)
		}
		description, err := skillFrontmatterDescription(content)
		if err != nil {
			return nil, fmt.Errorf("load %s frontmatter: %w", entry.Name(), err)
		}
		skill := AgentSkillData{
			Name:        namePrefix + entry.Name(),
			Description: description,
			Content:     string(content),
		}
		err = fs.WalkDir(fsys, dir, func(filePath string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			rel := strings.TrimPrefix(filePath, dir+"/")
			if rel == "SKILL.md" {
				return nil
			}
			data, err := fs.ReadFile(fsys, filePath)
			if err != nil {
				return err
			}
			skill.Files = append(skill.Files, AgentSkillFileData{Path: rel, Content: string(data)})
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("load %s files: %w", entry.Name(), err)
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

func skillFrontmatterDescription(content []byte) (string, error) {
	text := string(content)
	if !strings.HasPrefix(text, "---\n") {
		return "", errors.New("missing YAML frontmatter")
	}
	rest := text[len("---\n"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", errors.New("unterminated YAML frontmatter")
	}
	var frontmatter struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}
	if err := yaml.Unmarshal([]byte(rest[:end]), &frontmatter); err != nil {
		return "", err
	}
	if strings.TrimSpace(frontmatter.Name) == "" || strings.TrimSpace(frontmatter.Description) == "" {
		return "", errors.New("name and description are required")
	}
	return strings.TrimSpace(frontmatter.Description), nil
}
