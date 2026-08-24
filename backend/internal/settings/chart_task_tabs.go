package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

const (
	chartTaskTabsKey              = "taskTabs"
	maxChartTasks                 = 12
	maxChartTaskIDBytes           = 128
	maxChartTaskTabsDocumentBytes = 512 * 1024
)

var ErrChartTaskTabsConflict = errors.New("settings: chart task tabs revision conflict")

// ChartTaskTabsDocument is the backend-owned durable projection of the open
// desktop chart tasks. Revision is assigned by the server.
type ChartTaskTabsDocument struct {
	Version      int         `json:"version"`
	Revision     int64       `json:"revision"`
	ActiveTaskID string      `json:"activeTaskId"`
	Tasks        []ChartTask `json:"tasks"`
}

type ChartTask struct {
	ID               string          `json:"id"`
	DrawingContextID string          `json:"drawingContextId"`
	Workspace        json.RawMessage `json:"workspace"`
	ActiveLayoutID   *string         `json:"activeLayoutId"`
}

type ChartTaskTabsWrite struct {
	ExpectedRevision int64                 `json:"expectedRevision"`
	Document         ChartTaskTabsDocument `json:"document"`
}

// ChartTaskTabsStore is separate from the general settings Store so existing
// narrow test doubles and bootstrap readers remain source-compatible.
type ChartTaskTabsStore interface {
	GetChartTaskTabs(ctx context.Context, userID string) (ChartTaskTabsDocument, error)
	ReplaceChartTaskTabs(ctx context.Context, userID string, input ChartTaskTabsWrite) (ChartTaskTabsDocument, error)
}

func ValidateChartTaskTabsDocument(doc ChartTaskTabsDocument) error {
	if doc.Version != 1 {
		return fmt.Errorf("%w: chart task tabs version must be 1", ErrBadPatch)
	}
	if doc.Revision < 0 {
		return fmt.Errorf("%w: chart task tabs revision must be non-negative", ErrBadPatch)
	}
	if len(doc.Tasks) < 1 || len(doc.Tasks) > maxChartTasks {
		return fmt.Errorf("%w: chart task tabs must contain 1 to %d tasks", ErrBadPatch, maxChartTasks)
	}
	if !validChartTaskID(doc.ActiveTaskID) {
		return fmt.Errorf("%w: activeTaskId is invalid", ErrBadPatch)
	}

	taskIDs := make(map[string]struct{}, len(doc.Tasks))
	contextIDs := make(map[string]struct{}, len(doc.Tasks))
	for index, task := range doc.Tasks {
		if !validChartTaskID(task.ID) {
			return fmt.Errorf("%w: task %d id is invalid", ErrBadPatch, index)
		}
		if _, duplicate := taskIDs[task.ID]; duplicate {
			return fmt.Errorf("%w: task ids must be unique", ErrBadPatch)
		}
		taskIDs[task.ID] = struct{}{}

		if !validChartTaskID(task.DrawingContextID) {
			return fmt.Errorf("%w: task %d drawingContextId is invalid", ErrBadPatch, index)
		}
		if _, duplicate := contextIDs[task.DrawingContextID]; duplicate {
			return fmt.Errorf("%w: drawing context ids must be unique", ErrBadPatch)
		}
		contextIDs[task.DrawingContextID] = struct{}{}

		if task.ActiveLayoutID != nil && !validChartTaskID(*task.ActiveLayoutID) {
			return fmt.Errorf("%w: task %d activeLayoutId is invalid", ErrBadPatch, index)
		}
		if !validJSONObject(task.Workspace) {
			return fmt.Errorf("%w: task %d workspace must be a JSON object", ErrBadPatch, index)
		}
	}
	if _, ok := taskIDs[doc.ActiveTaskID]; !ok {
		return fmt.Errorf("%w: activeTaskId must identify an existing task", ErrBadPatch)
	}

	encoded, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("%w: marshal chart task tabs: %v", ErrBadPatch, err)
	}
	if len(encoded) > maxChartTaskTabsDocumentBytes {
		return fmt.Errorf("%w: chart task tabs document exceeds %d bytes", ErrBadPatch, maxChartTaskTabsDocumentBytes)
	}
	return nil
}

func ChartTaskTabsFromDocument(doc Document) ChartTaskTabsDocument {
	empty := ChartTaskTabsDocument{Version: 1, Tasks: []ChartTask{}}
	chart, err := rawObject(doc.Chart)
	if err != nil {
		return empty
	}
	value, ok := chart[chartTaskTabsKey]
	if !ok {
		return empty
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return empty
	}
	var taskTabs ChartTaskTabsDocument
	if err := json.Unmarshal(encoded, &taskTabs); err != nil {
		return empty
	}
	if err := ValidateChartTaskTabsDocument(taskTabs); err != nil {
		return empty
	}
	return cloneChartTaskTabs(taskTabs)
}

func ApplyChartTaskTabsWrite(base Document, input ChartTaskTabsWrite) (Document, ChartTaskTabsDocument, error) {
	if input.ExpectedRevision < 0 {
		return Document{}, ChartTaskTabsDocument{}, fmt.Errorf("%w: expectedRevision must be non-negative", ErrBadPatch)
	}
	current := ChartTaskTabsFromDocument(base)
	if input.ExpectedRevision != current.Revision {
		return Document{}, ChartTaskTabsDocument{}, ErrChartTaskTabsConflict
	}
	if current.Revision == math.MaxInt64 {
		return Document{}, ChartTaskTabsDocument{}, fmt.Errorf("%w: chart task tabs revision exhausted", ErrBadPatch)
	}
	saved := cloneChartTaskTabs(input.Document)
	saved.Revision = current.Revision + 1
	if err := ValidateChartTaskTabsDocument(saved); err != nil {
		return Document{}, ChartTaskTabsDocument{}, err
	}

	chart, err := rawObject(base.Chart)
	if err != nil {
		return Document{}, ChartTaskTabsDocument{}, err
	}
	chart[chartTaskTabsKey] = saved
	encoded, err := json.Marshal(chart)
	if err != nil {
		return Document{}, ChartTaskTabsDocument{}, fmt.Errorf("%w: marshal chart settings: %v", ErrBadPatch, err)
	}
	next := base
	next.Chart = json.RawMessage(encoded)
	return next, cloneChartTaskTabs(saved), nil
}

func validChartTaskID(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= maxChartTaskIDBytes
}

func validJSONObject(raw json.RawMessage) bool {
	if len(raw) == 0 || !json.Valid(raw) {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(raw, &object) == nil && object != nil
}

func cloneChartTaskTabs(input ChartTaskTabsDocument) ChartTaskTabsDocument {
	out := input
	out.Tasks = make([]ChartTask, len(input.Tasks))
	for index, task := range input.Tasks {
		out.Tasks[index] = task
		out.Tasks[index].Workspace = cloneRaw(task.Workspace)
		if task.ActiveLayoutID != nil {
			activeLayoutID := *task.ActiveLayoutID
			out.Tasks[index].ActiveLayoutID = &activeLayoutID
		}
	}
	return out
}

func (r *Repo) GetChartTaskTabs(ctx context.Context, userID string) (ChartTaskTabsDocument, error) {
	doc, err := r.Get(ctx, userID)
	if err != nil {
		return ChartTaskTabsDocument{}, err
	}
	return ChartTaskTabsFromDocument(doc), nil
}

func (r *Repo) ReplaceChartTaskTabs(ctx context.Context, userID string, input ChartTaskTabsWrite) (ChartTaskTabsDocument, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return ChartTaskTabsDocument{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return ChartTaskTabsDocument{}, err
	}
	defer tx.Rollback(ctx)

	current, err := ensureAndGetForUpdate(ctx, tx, uid)
	if err != nil {
		return ChartTaskTabsDocument{}, err
	}
	next, saved, err := ApplyChartTaskTabsWrite(current, input)
	if err != nil {
		return ChartTaskTabsDocument{}, err
	}
	if _, err = tx.Exec(ctx, `
UPDATE user_settings
SET chart = $2, updated_at = now()
WHERE user_id = $1
`, uid, next.Chart); err != nil {
		return ChartTaskTabsDocument{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ChartTaskTabsDocument{}, err
	}
	return saved, nil
}
