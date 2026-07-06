package settings

import (
	"encoding/json"
	"errors"
	"fmt"
)

var (
	ErrBadPatch = errors.New("settings: bad patch")
	emptyJSON   = json.RawMessage(`{}`)
)

// Document is the complete persisted settings payload returned by the settings API.
type Document struct {
	UI            json.RawMessage `json:"ui"`
	SMC           json.RawMessage `json:"smc"`
	Chart         json.RawMessage `json:"chart"`
	Notifications json.RawMessage `json:"notifications"`
}

// Patch is a partial settings update. Nil means "section not touched".
type Patch struct {
	UI            *json.RawMessage
	SMC           *json.RawMessage
	Chart         *json.RawMessage
	Notifications *json.RawMessage
}

func EmptyDocument() Document {
	return Document{
		UI:            cloneRaw(emptyJSON),
		SMC:           cloneRaw(emptyJSON),
		Chart:         cloneRaw(emptyJSON),
		Notifications: cloneRaw(emptyJSON),
	}
}

func NormalizeDocument(doc Document) Document {
	return Document{
		UI:            normalizeSection(doc.UI),
		SMC:           normalizeSection(doc.SMC),
		Chart:         normalizeSection(doc.Chart),
		Notifications: normalizeSection(doc.Notifications),
	}
}

func ApplyPatch(base Document, patch Patch) (Document, error) {
	base = NormalizeDocument(base)
	var err error

	if patch.UI != nil {
		base.UI, err = mergeJSONObjects(base.UI, *patch.UI)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.SMC != nil {
		base.SMC, err = mergeJSONObjects(base.SMC, *patch.SMC)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.Chart != nil {
		base.Chart, err = mergeJSONObjects(base.Chart, *patch.Chart)
		if err != nil {
			return Document{}, err
		}
	}
	if patch.Notifications != nil {
		base.Notifications, err = mergeJSONObjects(base.Notifications, *patch.Notifications)
		if err != nil {
			return Document{}, err
		}
	}
	return base, nil
}

func normalizeSection(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return cloneRaw(emptyJSON)
	}
	return cloneRaw(raw)
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	out := make(json.RawMessage, len(raw))
	copy(out, raw)
	return out
}

func mergeJSONObjects(baseRaw, patchRaw json.RawMessage) (json.RawMessage, error) {
	baseMap, err := rawObject(baseRaw)
	if err != nil {
		return nil, err
	}
	patchMap, err := rawObject(patchRaw)
	if err != nil {
		return nil, err
	}
	merged := deepMerge(baseMap, patchMap)
	out, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal merged settings: %v", ErrBadPatch, err)
	}
	return json.RawMessage(out), nil
}

func rawObject(raw json.RawMessage) (map[string]any, error) {
	raw = normalizeSection(raw)
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("%w: invalid JSON object", ErrBadPatch)
	}
	if obj == nil {
		return nil, fmt.Errorf("%w: section must be a JSON object", ErrBadPatch)
	}
	return obj, nil
}

func deepMerge(base, patch map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(patch))
	for k, v := range base {
		out[k] = v
	}
	for k, patchValue := range patch {
		if patchObj, ok := patchValue.(map[string]any); ok {
			if baseObj, ok := out[k].(map[string]any); ok {
				out[k] = deepMerge(baseObj, patchObj)
				continue
			}
		}
		out[k] = patchValue
	}
	return out
}
