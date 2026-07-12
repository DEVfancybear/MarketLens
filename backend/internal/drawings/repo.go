package drawings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	List(ctx context.Context, userID, symbol string) ([]Drawing, error)
	Create(ctx context.Context, userID string, input DrawingWrite) (Drawing, error)
	Replace(ctx context.Context, userID, id string, input DrawingWrite) (Drawing, error)
	Patch(ctx context.Context, userID, id string, patch DrawingPatch) (Drawing, error)
	Delete(ctx context.Context, userID, id string) error
	Batch(ctx context.Context, userID string, req BatchRequest) (BatchResponse, error)

	ListTemplates(ctx context.Context, userID string) ([]DrawingTemplate, error)
	SaveTemplate(ctx context.Context, userID string, input DrawingTemplateWrite) (DrawingTemplate, error)
	UpdateTemplate(ctx context.Context, userID, id string, input DrawingTemplateWrite) (DrawingTemplate, error)
	DeleteTemplate(ctx context.Context, userID, id string) error

	GetToolFavorites(ctx context.Context, userID string) (DrawingToolFavorites, error)
	ReplaceToolFavorites(ctx context.Context, userID string, input DrawingToolFavoritesWrite) (DrawingToolFavorites, error)
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID, symbol string) ([]Drawing, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	symbol = normalizeRequired("symbol", symbol)
	if symbol == "" {
		return nil, fmt.Errorf("%w: symbol is required", ErrBadRequest)
	}

	rows, err := r.pool.Query(ctx, `
SELECT id, symbol, tool_type, payload, locked, hidden, COALESCE(client_id, ''), revision, client_revision, deleted_at, created_at, updated_at
FROM drawings
WHERE user_id = $1 AND symbol = $2 AND deleted_at IS NULL
ORDER BY created_at, id`, uid, symbol)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Drawing{}
	for rows.Next() {
		d, err := scanDrawing(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repo) Create(ctx context.Context, userID string, input DrawingWrite) (Drawing, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Drawing{}, err
	}
	input, err = normalizeDrawingWrite(input)
	if err != nil {
		return Drawing{}, err
	}
	return r.upsertDrawing(ctx, r.pool, uid, input)
}

func (r *Repo) Replace(ctx context.Context, userID, id string, input DrawingWrite) (Drawing, error) {
	uid, did, err := parseOwnedID(userID, id)
	if err != nil {
		return Drawing{}, err
	}
	input, err = normalizeDrawingWrite(input)
	if err != nil {
		return Drawing{}, err
	}

	d, err := scanDrawing(r.pool.QueryRow(ctx, `
UPDATE drawings
SET symbol = $3, tool_type = $4, payload = $5, locked = $6, hidden = $7, client_id = NULLIF($8, ''), updated_at = now()
	, client_revision = $9, revision = revision + 1, deleted_at = NULL
WHERE id = $1 AND user_id = $2 AND ($10::bigint IS NULL OR revision = $10)
RETURNING id, symbol, tool_type, payload, locked, hidden, COALESCE(client_id, ''), revision, client_revision, deleted_at, created_at, updated_at`,
		did, uid, input.Symbol, input.ToolType, input.Payload, input.Locked, input.Hidden, input.ClientID, input.ClientRevision, input.ExpectedRevision))
	if errors.Is(err, pgx.ErrNoRows) {
		if input.ExpectedRevision != nil {
			return Drawing{}, ErrConflict
		}
		return Drawing{}, ErrNotFound
	}
	return d, err
}

func (r *Repo) Patch(ctx context.Context, userID, id string, patch DrawingPatch) (Drawing, error) {
	uid, did, err := parseOwnedID(userID, id)
	if err != nil {
		return Drawing{}, err
	}
	if patch.Payload != nil && !validJSON(*patch.Payload) {
		return Drawing{}, fmt.Errorf("%w: payload must be json", ErrBadRequest)
	}
	if patch.ClientRevision != nil && *patch.ClientRevision < 0 {
		return Drawing{}, fmt.Errorf("%w: clientRevision must be non-negative", ErrBadRequest)
	}
	if patch.ExpectedRevision != nil && *patch.ExpectedRevision < 1 {
		return Drawing{}, fmt.Errorf("%w: expectedRevision must be positive", ErrBadRequest)
	}
	symbol := trimPtr(patch.Symbol)
	toolType := trimPtr(patch.ToolType)
	clientID := trimPtr(patch.ClientID)
	clientRevision := patch.ClientRevision

	d, err := scanDrawing(r.pool.QueryRow(ctx, `
UPDATE drawings
SET symbol = COALESCE(NULLIF($3, ''), symbol),
    tool_type = COALESCE(NULLIF($4, ''), tool_type),
    payload = COALESCE($5::jsonb, payload),
    locked = COALESCE($6, locked),
    hidden = COALESCE($7, hidden),
    client_id = COALESCE(NULLIF($8, ''), client_id),
	client_revision = COALESCE($9, client_revision),
	revision = revision + 1,
	deleted_at = NULL,
    updated_at = now()
WHERE id = $1 AND user_id = $2 AND ($10::bigint IS NULL OR revision = $10)
RETURNING id, symbol, tool_type, payload, locked, hidden, COALESCE(client_id, ''), revision, client_revision, deleted_at, created_at, updated_at`,
		did, uid, symbol, toolType, patch.Payload, patch.Locked, patch.Hidden, clientID, clientRevision, patch.ExpectedRevision))
	if errors.Is(err, pgx.ErrNoRows) {
		if patch.ExpectedRevision != nil {
			return Drawing{}, ErrConflict
		}
		return Drawing{}, ErrNotFound
	}
	return d, err
}

func (r *Repo) Delete(ctx context.Context, userID, id string) error {
	uid, did, err := parseOwnedID(userID, id)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `UPDATE drawings SET deleted_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, did, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Batch(ctx context.Context, userID string, req BatchRequest) (BatchResponse, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return BatchResponse{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return BatchResponse{}, err
	}
	defer tx.Rollback(ctx)

	resp := BatchResponse{Upserted: []Drawing{}}
	for _, item := range req.Deletes {
		n, err := deleteByAnyID(ctx, tx, uid, item)
		if err != nil {
			return BatchResponse{}, err
		}
		resp.Deleted += n
	}
	for _, input := range req.Upserts {
		input, err = normalizeDrawingWrite(input)
		if err != nil {
			return BatchResponse{}, err
		}
		d, err := r.upsertDrawing(ctx, tx, uid, input)
		if err != nil {
			return BatchResponse{}, err
		}
		resp.Upserted = append(resp.Upserted, d)
	}
	if err := tx.Commit(ctx); err != nil {
		return BatchResponse{}, err
	}
	return resp, nil
}

func (r *Repo) ListTemplates(ctx context.Context, userID string) ([]DrawingTemplate, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, name, family, style, created_at, updated_at
FROM drawing_templates
WHERE user_id = $1
ORDER BY family, name`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DrawingTemplate{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repo) SaveTemplate(ctx context.Context, userID string, input DrawingTemplateWrite) (DrawingTemplate, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return DrawingTemplate{}, err
	}
	input, err = normalizeTemplateWrite(input)
	if err != nil {
		return DrawingTemplate{}, err
	}

	return scanTemplate(r.pool.QueryRow(ctx, `
INSERT INTO drawing_templates (user_id, name, family, style)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, name, family) DO UPDATE
SET style = EXCLUDED.style, updated_at = now()
RETURNING id, name, family, style, created_at, updated_at`,
		uid, input.Name, input.Family, input.Style))
}

func (r *Repo) UpdateTemplate(ctx context.Context, userID, id string, input DrawingTemplateWrite) (DrawingTemplate, error) {
	uid, tid, err := parseOwnedID(userID, id)
	if err != nil {
		return DrawingTemplate{}, err
	}
	input, err = normalizeTemplateWrite(input)
	if err != nil {
		return DrawingTemplate{}, err
	}
	t, err := scanTemplate(r.pool.QueryRow(ctx, `
UPDATE drawing_templates
SET name = $3, family = $4, style = $5, updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING id, name, family, style, created_at, updated_at`,
		tid, uid, input.Name, input.Family, input.Style))
	if errors.Is(err, pgx.ErrNoRows) {
		return DrawingTemplate{}, ErrNotFound
	}
	return t, err
}

func (r *Repo) DeleteTemplate(ctx context.Context, userID, id string) error {
	uid, tid, err := parseOwnedID(userID, id)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM drawing_templates WHERE id = $1 AND user_id = $2`, tid, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) GetToolFavorites(ctx context.Context, userID string) (DrawingToolFavorites, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return DrawingToolFavorites{}, err
	}
	favs, err := scanToolFavorites(r.pool.QueryRow(ctx, `
SELECT tools, updated_at
FROM drawing_tool_favorites
WHERE user_id = $1`, uid))
	if errors.Is(err, pgx.ErrNoRows) {
		return DrawingToolFavorites{Tools: []string{}}, nil
	}
	return favs, err
}

func (r *Repo) ReplaceToolFavorites(ctx context.Context, userID string, input DrawingToolFavoritesWrite) (DrawingToolFavorites, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return DrawingToolFavorites{}, err
	}
	tools := normalizeToolFavorites(input.Tools)
	raw, err := json.Marshal(tools)
	if err != nil {
		return DrawingToolFavorites{}, err
	}
	return scanToolFavorites(r.pool.QueryRow(ctx, `
INSERT INTO drawing_tool_favorites (user_id, tools)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
SET tools = EXCLUDED.tools, updated_at = now()
RETURNING tools, updated_at`, uid, json.RawMessage(raw)))
}

type queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (r *Repo) upsertDrawing(ctx context.Context, q queryer, uid pgtype.UUID, input DrawingWrite) (Drawing, error) {
	if input.ClientID == "" {
		return scanDrawing(q.QueryRow(ctx, `
INSERT INTO drawings (user_id, symbol, tool_type, payload, locked, hidden, client_revision)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, symbol, tool_type, payload, locked, hidden, COALESCE(client_id, ''), revision, client_revision, deleted_at, created_at, updated_at`,
			uid, input.Symbol, input.ToolType, input.Payload, input.Locked, input.Hidden, input.ClientRevision))
	}

	d, err := scanDrawing(q.QueryRow(ctx, `
INSERT INTO drawings (user_id, symbol, tool_type, payload, locked, hidden, client_id, client_revision)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
SET symbol = EXCLUDED.symbol,
    tool_type = EXCLUDED.tool_type,
    payload = EXCLUDED.payload,
    locked = EXCLUDED.locked,
    hidden = EXCLUDED.hidden,
	client_revision = EXCLUDED.client_revision,
	revision = drawings.revision + 1,
	deleted_at = NULL,
    updated_at = now()
WHERE $9::bigint IS NULL OR drawings.revision = $9
RETURNING id, symbol, tool_type, payload, locked, hidden, COALESCE(client_id, ''), revision, client_revision, deleted_at, created_at, updated_at`,
		uid, input.Symbol, input.ToolType, input.Payload, input.Locked, input.Hidden, input.ClientID, input.ClientRevision, input.ExpectedRevision))
	if errors.Is(err, pgx.ErrNoRows) && input.ExpectedRevision != nil {
		return Drawing{}, ErrConflict
	}
	if err != nil && isUniqueViolation(err) {
		return Drawing{}, fmt.Errorf("%w: duplicate drawing id", ErrBadRequest)
	}
	return d, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDrawing(row scanner) (Drawing, error) {
	var id pgtype.UUID
	var d Drawing
	if err := row.Scan(&id, &d.Symbol, &d.ToolType, &d.Payload, &d.Locked, &d.Hidden, &d.ClientID, &d.Revision, &d.ClientRevision, &d.DeletedAt, &d.CreatedAt, &d.UpdatedAt); err != nil {
		return Drawing{}, err
	}
	d.ID = uuidString(id)
	if d.Payload == nil {
		d.Payload = json.RawMessage(`{}`)
	}
	return d, nil
}

func scanTemplate(row scanner) (DrawingTemplate, error) {
	var id pgtype.UUID
	var t DrawingTemplate
	if err := row.Scan(&id, &t.Name, &t.Family, &t.Style, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return DrawingTemplate{}, err
	}
	t.ID = uuidString(id)
	if t.Style == nil {
		t.Style = json.RawMessage(`{}`)
	}
	return t, nil
}

func scanToolFavorites(row scanner) (DrawingToolFavorites, error) {
	var raw json.RawMessage
	var favs DrawingToolFavorites
	if err := row.Scan(&raw, &favs.UpdatedAt); err != nil {
		return DrawingToolFavorites{}, err
	}
	if len(raw) == 0 {
		favs.Tools = []string{}
		return favs, nil
	}
	if err := json.Unmarshal(raw, &favs.Tools); err != nil {
		return DrawingToolFavorites{}, err
	}
	favs.Tools = normalizeToolFavorites(favs.Tools)
	return favs, nil
}

func deleteByAnyID(ctx context.Context, tx pgx.Tx, uid pgtype.UUID, item DrawingDelete) (int, error) {
	if item.ExpectedRevision != nil && *item.ExpectedRevision < 1 {
		return 0, fmt.Errorf("%w: expectedRevision must be positive", ErrBadRequest)
	}
	if strings.TrimSpace(item.ID) != "" {
		id, err := parseUUID(item.ID)
		if err != nil {
			return 0, nil
		}
		tag, err := tx.Exec(ctx, `UPDATE drawings SET deleted_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND ($3::bigint IS NULL OR revision = $3)`, id, uid, item.ExpectedRevision)
		if err == nil && tag.RowsAffected() == 0 && item.ExpectedRevision != nil {
			return 0, ErrConflict
		}
		return int(tag.RowsAffected()), err
	}
	clientID := strings.TrimSpace(item.ClientID)
	if clientID == "" {
		return 0, nil
	}
	tag, err := tx.Exec(ctx, `UPDATE drawings SET deleted_at = now(), revision = revision + 1, updated_at = now() WHERE user_id = $1 AND client_id = $2 AND deleted_at IS NULL AND ($3::bigint IS NULL OR revision = $3)`, uid, clientID, item.ExpectedRevision)
	if err == nil && tag.RowsAffected() == 0 && item.ExpectedRevision != nil {
		return 0, ErrConflict
	}
	return int(tag.RowsAffected()), err
}

func normalizeDrawingWrite(input DrawingWrite) (DrawingWrite, error) {
	input.Symbol = normalizeRequired("symbol", input.Symbol)
	input.ToolType = strings.TrimSpace(input.ToolType)
	input.ClientID = strings.TrimSpace(input.ClientID)
	if input.ClientRevision < 0 {
		return DrawingWrite{}, fmt.Errorf("%w: clientRevision must be non-negative", ErrBadRequest)
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision < 1 {
		return DrawingWrite{}, fmt.Errorf("%w: expectedRevision must be positive", ErrBadRequest)
	}
	if input.Symbol == "" {
		return DrawingWrite{}, fmt.Errorf("%w: symbol is required", ErrBadRequest)
	}
	if input.ToolType == "" {
		return DrawingWrite{}, fmt.Errorf("%w: toolType is required", ErrBadRequest)
	}
	if !validJSON(input.Payload) {
		return DrawingWrite{}, fmt.Errorf("%w: payload must be json", ErrBadRequest)
	}
	return input, nil
}

func normalizeTemplateWrite(input DrawingTemplateWrite) (DrawingTemplateWrite, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Family = strings.TrimSpace(input.Family)
	if input.Name == "" {
		return DrawingTemplateWrite{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	if input.Family == "" {
		return DrawingTemplateWrite{}, fmt.Errorf("%w: family is required", ErrBadRequest)
	}
	if len(input.Style) == 0 {
		input.Style = json.RawMessage(`{}`)
	}
	if !validJSON(input.Style) {
		return DrawingTemplateWrite{}, fmt.Errorf("%w: style must be json", ErrBadRequest)
	}
	return input, nil
}

func normalizeToolFavorites(input []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range input {
		tool := strings.TrimSpace(value)
		if tool == "" || seen[tool] {
			continue
		}
		seen[tool] = true
		out = append(out, tool)
	}
	return out
}

func normalizeRequired(_ string, value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func validJSON(raw json.RawMessage) bool {
	return len(raw) > 0 && json.Valid(raw)
}

func trimPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func parseOwnedID(userID, id string) (pgtype.UUID, pgtype.UUID, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, err
	}
	did, err := parseUUID(id)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, ErrNotFound
	}
	return uid, did, nil
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(strings.TrimSpace(s)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("drawings: invalid id: %w", err)
	}
	return u, nil
}

func uuidString(u pgtype.UUID) string {
	v, err := u.Value()
	if err != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
