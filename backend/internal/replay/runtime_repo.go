package replay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
)

const maxStepCount = 100

type eventDraft struct {
	typ     string
	payload any
}

type runtimeBarQueries interface {
	GetReplayDatasetBarBySeq(context.Context, gen.GetReplayDatasetBarBySeqParams) (gen.ReplayDatasetBar, error)
	FindReplayDatasetBarAtOrBefore(context.Context, gen.FindReplayDatasetBarAtOrBeforeParams) (gen.ReplayDatasetBar, error)
	ListReplayDatasetBarsThroughSeq(context.Context, gen.ListReplayDatasetBarsThroughSeqParams) ([]gen.ReplayDatasetBar, error)
	ListReplayDatasetBarsBySeqRange(context.Context, gen.ListReplayDatasetBarsBySeqRangeParams) ([]gen.ReplayDatasetBar, error)
}

type commandRejection struct {
	Code           string `json:"code"`
	CurrentVersion int64  `json:"currentVersion,omitempty"`
}

func (r *Repo) ApplyCommand(ctx context.Context, userID, sessionID string, input CommandInput) (CommandResult, []EventEnvelope, error) {
	return r.applyCommand(ctx, r.pool, userID, sessionID, input)
}

type commandBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

func (r *Repo) applyCommand(ctx context.Context, beginner commandBeginner, userID, sessionID string, input CommandInput) (CommandResult, []EventEnvelope, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return CommandResult{}, nil, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return CommandResult{}, nil, ErrNotFound
	}
	tx, err := beginner.Begin(ctx)
	if err != nil {
		return CommandResult{}, nil, err
	}
	defer tx.Rollback(ctx)
	q := r.queries.WithTx(tx)
	locked, err := q.TryLockReplaySession(ctx, sessionID)
	if err != nil {
		return CommandResult{}, nil, err
	}
	if !locked {
		return CommandResult{}, nil, ErrSessionBusy
	}
	session, err := q.GetReplaySessionForUserForUpdate(ctx, gen.GetReplaySessionForUserForUpdateParams{ID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		return CommandResult{}, nil, ErrNotFound
	}
	if err != nil {
		return CommandResult{}, nil, err
	}

	existing, err := q.GetReplayCommandByIdempotency(ctx, gen.GetReplayCommandByIdempotencyParams{
		SessionID: sid, UserID: uid, IdempotencyKey: input.IdempotencyKey,
	})
	if err == nil {
		return duplicateCommandResult(existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return CommandResult{}, nil, err
	}
	commandSeq, err := q.NextReplayCommandSeq(ctx, sid)
	if err != nil {
		return CommandResult{}, nil, err
	}
	payload := normalizedPayload(input.Payload)
	command, err := q.CreateReplayCommand(ctx, gen.CreateReplayCommandParams{
		SessionID: sid, CommandSeq: int64(commandSeq), IdempotencyKey: input.IdempotencyKey,
		ExpectedVersion: input.ExpectedVersion, CommandType: input.Type, Payload: payload,
	})
	if err != nil {
		return CommandResult{}, nil, err
	}
	if input.ExpectedVersion != nil && *input.ExpectedVersion != session.Version {
		rejection, _ := json.Marshal(commandRejection{Code: "version_conflict", CurrentVersion: session.Version})
		if _, err := q.MarkReplayCommandRejected(ctx, gen.MarkReplayCommandRejectedParams{ID: command.ID, Result: rejection}); err != nil {
			return CommandResult{}, nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return CommandResult{}, nil, err
		}
		return CommandResult{}, nil, &VersionConflictError{CurrentVersion: session.Version}
	}
	if session.Status == gen.ReplaySessionStatusClosed {
		rejection, _ := json.Marshal(commandRejection{Code: "session_closed"})
		if _, err := q.MarkReplayCommandRejected(ctx, gen.MarkReplayCommandRejectedParams{ID: command.ID, Result: rejection}); err != nil {
			return CommandResult{}, nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return CommandResult{}, nil, err
		}
		return CommandResult{}, nil, ErrSessionClosed
	}
	leaseChanged, err := claimRuntimeActor(&session, input)
	if err != nil {
		return CommandResult{}, nil, err
	}

	tracks, err := q.ListReplayTracksForSessionForUpdate(ctx, sid)
	if err != nil {
		return CommandResult{}, nil, err
	}
	if len(tracks) < 1 || len(tracks) > 4 {
		return CommandResult{}, nil, fmt.Errorf("replay: expected between one and four tracks, got %d", len(tracks))
	}
	ledger := &ledgerRuntime{db: tx, sessionID: sid}
	drafts, changed, err := applyRuntimeTransitionTracks(ctx, q, &session, tracks, input, ledger)
	if err != nil {
		return CommandResult{}, nil, err
	}
	if session.Status != gen.ReplaySessionStatusPlaying && session.ActorOwner != nil {
		session.ActorOwner = nil
		session.ActorLeaseUntil = pgtype.Timestamptz{}
		leaseChanged = true
	}
	if changed {
		session.Version++
		session.NextEventSeq += int64(len(drafts))
	}
	if changed || leaseChanged {
		updated, err := q.UpdateReplayRuntimeSession(ctx, gen.UpdateReplayRuntimeSessionParams{
			ID: session.ID, Status: session.Status, Version: session.Version, NextEventSeq: session.NextEventSeq,
			Speed: session.Speed, SimulatedTime: session.SimulatedTime, PauseReason: session.PauseReason, ClosedAt: session.ClosedAt,
			ActorOwner: session.ActorOwner, ActorLeaseUntil: session.ActorLeaseUntil, ReplayIntervalSeconds: session.ReplayIntervalSeconds,
		})
		if err != nil {
			return CommandResult{}, nil, err
		}
		session = updated
	}
	if changed {
		for _, track := range tracks {
			if _, err := q.UpdateReplayTrackCursor(ctx, gen.UpdateReplayTrackCursorParams{
				ID: track.ID, CursorSeq: track.CursorSeq, VisibleThrough: track.VisibleThrough, AggregateState: track.AggregateState,
			}); err != nil {
				return CommandResult{}, nil, err
			}
		}
	}

	events := make([]EventEnvelope, 0, len(drafts))
	firstSeq := session.NextEventSeq - int64(len(drafts))
	for i, draft := range drafts {
		payload, err := json.Marshal(draft.payload)
		if err != nil {
			return CommandResult{}, nil, err
		}
		row, err := q.CreateReplayEvent(ctx, gen.CreateReplayEventParams{
			SessionID: sid, EventSeq: firstSeq + int64(i), Version: session.Version,
			EventType: draft.typ, SimulatedAt: session.SimulatedTime, Payload: payload,
		})
		if err != nil {
			return CommandResult{}, nil, err
		}
		events = append(events, eventEnvelope(row))
	}
	if tradeChangedInDrafts(drafts) && len(events) > 0 {
		lastEventSeq := events[len(events)-1].EventSeq
		_, err := tx.Exec(ctx, `INSERT INTO replay_equity_points(session_id,event_seq,simulated_at,balance,equity,drawdown)
      SELECT a.session_id,$2,$3,a.balance,a.equity,
        GREATEST(0, COALESCE((SELECT max(ep.equity) FROM replay_equity_points ep WHERE ep.session_id=a.session_id),a.starting_equity)-a.equity)
      FROM replay_accounts a WHERE a.session_id=$1
      ON CONFLICT(session_id,event_seq) DO NOTHING`, sid, lastEventSeq, session.SimulatedTime.Time)
		if err != nil {
			return CommandResult{}, nil, err
		}
	}

	snapshot, err := snapshotWithQueries(ctx, q, tx, uid, sid)
	if err != nil {
		return CommandResult{}, nil, err
	}
	result := CommandResult{CommandID: uuidString(command.ID), Status: "applied", Snapshot: snapshot}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return CommandResult{}, nil, err
	}
	if changed {
		checksum := sha256.Sum256(resultJSONForCheckpoint(snapshot))
		if _, err := q.CreateReplayCheckpoint(ctx, gen.CreateReplayCheckpointParams{
			SessionID: sid, Generation: session.Generation, EventSeq: snapshot.LastEventSeq,
			SimulatedTime: session.SimulatedTime, Snapshot: resultJSONForCheckpoint(snapshot), ChecksumSha256: hex.EncodeToString(checksum[:]),
		}); err != nil {
			return CommandResult{}, nil, err
		}
	}
	if _, err := q.MarkReplayCommandApplied(ctx, gen.MarkReplayCommandAppliedParams{ID: command.ID, Result: resultJSON}); err != nil {
		return CommandResult{}, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CommandResult{}, nil, err
	}
	return result, events, nil
}

func tradeChangedInDrafts(drafts []eventDraft) bool {
	for _, draft := range drafts {
		if strings.HasPrefix(draft.typ, "order.") || draft.typ == "fill.created" ||
			draft.typ == "position.updated" || draft.typ == "account.updated" || draft.typ == "trading.reset" {
			return true
		}
	}
	return false
}

func claimRuntimeActor(session *gen.ReplaySession, input CommandInput) (bool, error) {
	commandType := strings.ToLower(strings.TrimSpace(input.Type))
	requiresActor := session.Status == gen.ReplaySessionStatusPlaying || commandType == "play" || commandType == "__clock_step"
	if !requiresActor {
		return false, nil
	}
	now := time.Now().UTC()
	activeOtherOwner := session.ActorOwner != nil && *session.ActorOwner != input.ActorOwner &&
		session.ActorLeaseUntil.Valid && session.ActorLeaseUntil.Time.After(now)
	if input.ActorOwner == "" {
		if commandType == "__pause_server_restart" && !activeOtherOwner {
			return false, nil
		}
		return false, ErrSessionBusy
	}
	if activeOtherOwner {
		return false, ErrSessionBusy
	}
	leaseUntil := input.ActorLeaseUntil.UTC()
	if leaseUntil.IsZero() || !leaseUntil.After(now) {
		leaseUntil = now.Add(5 * time.Second)
	}
	owner := input.ActorOwner
	changed := session.ActorOwner == nil || *session.ActorOwner != owner ||
		!session.ActorLeaseUntil.Valid || !session.ActorLeaseUntil.Time.Equal(leaseUntil)
	session.ActorOwner = &owner
	session.ActorLeaseUntil = timestamp(leaseUntil)
	return changed, nil
}

func (r *Repo) RenewActorLease(ctx context.Context, owner, sessionID string, leaseUntil time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE replay_sessions
SET actor_lease_until = $3
WHERE id = $1 AND status = 'playing' AND actor_owner = $2`, sessionID, owner, leaseUntil.UTC())
	return tag.RowsAffected() == 1, err
}

func (r *Repo) ReleaseActorLease(ctx context.Context, owner, sessionID string) error {
	_, err := r.pool.Exec(ctx, `UPDATE replay_sessions
SET actor_owner = NULL, actor_lease_until = NULL
WHERE id = $1 AND actor_owner = $2`, sessionID, owner)
	return err
}

func applyRuntimeTransitionTracks(
	ctx context.Context,
	q runtimeBarQueries,
	session *gen.ReplaySession,
	tracks []gen.ListReplayTracksForSessionForUpdateRow,
	input CommandInput,
	ledger *ledgerRuntime,
) ([]eventDraft, bool, error) {
	if len(tracks) == 1 {
		return applyRuntimeTransition(ctx, q, session, &tracks[0], input, ledger)
	}
	commandType := strings.ToLower(strings.TrimSpace(input.Type))
	switch commandType {
	case "step", "__clock_step":
		return applySynchronizedStep(ctx, q, session, tracks, input, ledger)
	case "seek", "restart":
		return applySynchronizedSeek(ctx, q, session, tracks, input, ledger)
	case "set_replay_interval":
		return applySynchronizedReplayInterval(session, tracks, input)
	case "place_order", "close_position":
		track, err := commandTrack(tracks, input.Payload)
		if err != nil {
			return nil, false, err
		}
		return applyRuntimeTransition(ctx, q, session, track, input, ledger)
	default:
		// Session-wide commands and trade commands that do not read a market bar
		// can use any track while retaining the single version/event transaction.
		return applyRuntimeTransition(ctx, q, session, &tracks[0], input, ledger)
	}
}

func commandTrack(tracks []gen.ListReplayTracksForSessionForUpdateRow, payload json.RawMessage) (*gen.ListReplayTracksForSessionForUpdateRow, error) {
	var body struct {
		TrackID string `json:"trackId"`
	}
	if err := json.Unmarshal(normalizedPayload(payload), &body); err != nil {
		return nil, fmt.Errorf("%w: invalid track payload", ErrBadRequest)
	}
	if body.TrackID == "" {
		return nil, fmt.Errorf("%w: trackId is required for synchronized replay trading", ErrBadRequest)
	}
	for i := range tracks {
		if uuidString(tracks[i].ID) == body.TrackID {
			return &tracks[i], nil
		}
	}
	return nil, fmt.Errorf("%w: order track does not belong to the session", ErrBadRequest)
}

func applySynchronizedStep(
	ctx context.Context,
	q runtimeBarQueries,
	session *gen.ReplaySession,
	tracks []gen.ListReplayTracksForSessionForUpdateRow,
	input CommandInput,
	ledger *ledgerRuntime,
) ([]eventDraft, bool, error) {
	commandType := strings.ToLower(strings.TrimSpace(input.Type))
	if commandType == "step" && session.Status != gen.ReplaySessionStatusPaused {
		return nil, false, fmt.Errorf("%w: step requires a paused session", ErrBadRequest)
	}
	if commandType == "__clock_step" && session.Status != gen.ReplaySessionStatusPlaying {
		return nil, false, nil
	}
	count, err := replayStepCount(input, commandType)
	if err != nil {
		return nil, false, err
	}
	oldStatus := session.Status
	oldSimulated := session.SimulatedTime.Time
	targetTime := oldSimulated.Add(time.Duration(int64(session.ReplayIntervalSeconds)*int64(count)) * time.Second)
	completionTime := tracks[0].LastTime.Time
	for i := 1; i < len(tracks); i++ {
		if tracks[i].LastTime.Time.Before(completionTime) {
			completionTime = tracks[i].LastTime.Time
		}
	}
	if session.EndTime.Valid && session.EndTime.Time.Before(completionTime) {
		completionTime = session.EndTime.Time
	}
	if targetTime.After(completionTime) {
		targetTime = completionTime
	}

	drafts := make([]eventDraft, 0, len(tracks)*4)
	changedTracks := make([]int, 0, len(tracks))
	tradeChanged := false
	for i := range tracks {
		track := &tracks[i]
		selected, findErr := q.FindReplayDatasetBarAtOrBefore(ctx, gen.FindReplayDatasetBarAtOrBeforeParams{
			DatasetID: track.DatasetID, OpenTime: timestamp(targetTime),
		})
		if findErr != nil {
			if errors.Is(findErr, pgx.ErrNoRows) {
				return nil, false, &DataUnavailableError{FirstAvailable: track.FirstTime.Time, LastAvailable: track.LastTime.Time}
			}
			return nil, false, findErr
		}
		if selected.Seq <= track.CursorSeq {
			// A sparse provider calendar (weekend/session gap) advances the shared
			// barrier without manufacturing a candle for this track.
			continue
		}
		rows, rowsErr := q.ListReplayDatasetBarsBySeqRange(ctx, gen.ListReplayDatasetBarsBySeqRangeParams{
			DatasetID: track.DatasetID, Seq: track.CursorSeq, Seq_2: selected.Seq,
		})
		if rowsErr != nil {
			return nil, false, rowsErr
		}
		state, stateErr := currentAggregateState(ctx, q, track)
		if stateErr != nil {
			return nil, false, stateErr
		}
		source := make([]sourceBar, 0, len(rows))
		for _, row := range rows {
			source = append(source, sourceBarFromRow(row))
		}
		state, upserts, aggregateErr := aggregateSourceBars(state, track.ChartTimeframe, source)
		if aggregateErr != nil {
			return nil, false, aggregateErr
		}
		track.AggregateState = marshalAggregateState(state)
		track.CursorSeq = selected.Seq
		track.VisibleThrough = selected.OpenTime
		changedTracks = append(changedTracks, i)
		drafts = appendReplayBarDrafts(
			drafts, uuidString(track.ID), coalesceBarUpserts(upserts),
			commandType == "__clock_step" && count > 1,
		)
		if ledger != nil {
			trading, tradeErr := ledger.processRows(ctx, track, rows)
			if tradeErr != nil {
				return nil, false, tradeErr
			}
			if len(trading) > 0 {
				tradeChanged = true
				drafts = append(drafts, trading...)
			}
		}
	}
	session.SimulatedTime = timestamp(targetTime)
	if !targetTime.Before(completionTime) {
		session.Status = gen.ReplaySessionStatusCompleted
		session.PauseReason = nil
	}
	for _, index := range changedTracks {
		track := &tracks[index]
		drafts = append(drafts, eventDraft{typ: "cursor.advanced", payload: map[string]any{
			"trackId": uuidString(track.ID), "cursorSeq": track.CursorSeq, "visibleThrough": track.VisibleThrough.Time,
		}})
	}
	if oldStatus != session.Status || len(changedTracks) == 0 {
		speed, _ := session.Speed.Float64Value()
		drafts = append(drafts, eventDraft{typ: "state.changed", payload: map[string]any{
			"status": string(session.Status), "speed": speed.Float64, "pauseReason": session.PauseReason,
			"replayIntervalSeconds": session.ReplayIntervalSeconds,
		}})
	}
	changed := oldStatus != session.Status || !oldSimulated.Equal(targetTime) || len(changedTracks) > 0 || tradeChanged
	return drafts, changed, nil
}

func applySynchronizedSeek(
	ctx context.Context,
	q runtimeBarQueries,
	session *gen.ReplaySession,
	tracks []gen.ListReplayTracksForSessionForUpdateRow,
	input CommandInput,
	ledger *ledgerRuntime,
) ([]eventDraft, bool, error) {
	commandType := strings.ToLower(strings.TrimSpace(input.Type))
	target := session.StartTime.Time
	resetTrading := false
	if commandType == "seek" {
		var body struct {
			Time         time.Time `json:"time"`
			ResetTrading bool      `json:"resetTrading"`
		}
		if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil || body.Time.IsZero() {
			return nil, false, fmt.Errorf("%w: seek.time is required", ErrBadRequest)
		}
		target = body.Time.UTC()
		resetTrading = body.ResetTrading
	} else {
		var body struct {
			ResetTrading bool `json:"resetTrading"`
		}
		_ = json.Unmarshal(normalizedPayload(input.Payload), &body)
		resetTrading = body.ResetTrading
	}
	drafts := make([]eventDraft, 0, len(tracks)*2+2)
	if ledger != nil && target.Before(session.SimulatedTime.Time) {
		hasFills, err := ledger.hasFills(ctx)
		if err != nil {
			return nil, false, err
		}
		if hasFills && !resetTrading {
			return nil, false, ErrRewindRequiresFork
		}
		if hasFills {
			resetEvents, resetErr := ledger.reset(ctx, target)
			if resetErr != nil {
				return nil, false, resetErr
			}
			drafts = append(drafts, resetEvents...)
		}
	}
	for i := range tracks {
		track := &tracks[i]
		lastAvailable := track.LastTime.Time.Add(time.Duration(track.BaseIntervalSeconds) * time.Second)
		if target.Before(track.FirstTime.Time) || !target.Before(lastAvailable) {
			return nil, false, &DataUnavailableError{FirstAvailable: track.FirstTime.Time, LastAvailable: lastAvailable}
		}
		selected, err := q.FindReplayDatasetBarAtOrBefore(ctx, gen.FindReplayDatasetBarAtOrBeforeParams{DatasetID: track.DatasetID, OpenTime: timestamp(target)})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, false, &DataUnavailableError{FirstAvailable: track.FirstTime.Time, LastAvailable: lastAvailable}
			}
			return nil, false, err
		}
		rows, err := q.ListReplayDatasetBarsThroughSeq(ctx, gen.ListReplayDatasetBarsThroughSeqParams{DatasetID: track.DatasetID, Seq: selected.Seq})
		if err != nil {
			return nil, false, err
		}
		source := make([]sourceBar, 0, len(rows))
		for _, row := range rows {
			source = append(source, sourceBarFromRow(row))
		}
		_, state, err := aggregateRevealedBars(track.ChartTimeframe, source)
		if err != nil {
			return nil, false, err
		}
		track.CursorSeq = selected.Seq
		track.VisibleThrough = selected.OpenTime
		track.AggregateState = marshalAggregateState(state)
		drafts = append(drafts, eventDraft{typ: "track.reset", payload: map[string]any{
			"trackId": uuidString(track.ID), "cursorSeq": track.CursorSeq, "visibleThrough": track.VisibleThrough.Time,
		}})
		drafts = append(drafts, eventDraft{typ: "cursor.advanced", payload: map[string]any{
			"trackId": uuidString(track.ID), "cursorSeq": track.CursorSeq, "visibleThrough": track.VisibleThrough.Time,
		}})
	}
	session.SimulatedTime = timestamp(target)
	session.Status = gen.ReplaySessionStatusPaused
	reason := commandType
	session.PauseReason = &reason
	speed, _ := session.Speed.Float64Value()
	drafts = append(drafts, eventDraft{typ: "state.changed", payload: map[string]any{
		"status": string(session.Status), "speed": speed.Float64, "pauseReason": session.PauseReason,
		"replayIntervalSeconds": session.ReplayIntervalSeconds,
	}})
	return drafts, true, nil
}

func applySynchronizedReplayInterval(session *gen.ReplaySession, tracks []gen.ListReplayTracksForSessionForUpdateRow, input CommandInput) ([]eventDraft, bool, error) {
	var body struct {
		ReplayInterval string `json:"replayInterval"`
	}
	if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil {
		return nil, false, fmt.Errorf("%w: invalid replay interval payload", ErrBadRequest)
	}
	normalized := make([]normalizedTrackInput, 0, len(tracks))
	for _, track := range tracks {
		_, chartSeconds, _ := normalizeTimeframe(track.ChartTimeframe)
		normalized = append(normalized, normalizedTrackInput{
			input:        TrackInput{Slot: int(track.Slot), Symbol: track.Symbol, ChartTimeframe: track.ChartTimeframe},
			chartSeconds: chartSeconds, sourceTimeframe: track.SourceTimeframe, sourceSeconds: int(track.BaseIntervalSeconds),
		})
	}
	interval, err := resolveReplayIntervalForTracks(body.ReplayInterval, normalized)
	if err != nil {
		return nil, false, err
	}
	if int32(interval) == session.ReplayIntervalSeconds {
		return nil, false, nil
	}
	session.ReplayIntervalSeconds = int32(interval)
	speed, _ := session.Speed.Float64Value()
	return []eventDraft{{typ: "state.changed", payload: map[string]any{
		"status": string(session.Status), "speed": speed.Float64, "pauseReason": session.PauseReason,
		"replayIntervalSeconds": session.ReplayIntervalSeconds,
	}}}, true, nil
}

func applyRuntimeTransition(ctx context.Context, q runtimeBarQueries, session *gen.ReplaySession, track *gen.ListReplayTracksForSessionForUpdateRow, input CommandInput, ledgers ...*ledgerRuntime) ([]eventDraft, bool, error) {
	oldStatus := session.Status
	oldSpeed, _ := session.Speed.Float64Value()
	oldCursor := track.CursorSeq
	oldSimulated := session.SimulatedTime.Time
	oldReplayInterval := session.ReplayIntervalSeconds
	oldAggregate := string(track.AggregateState)
	commandType := strings.ToLower(strings.TrimSpace(input.Type))
	drafts := make([]eventDraft, 0, 8)
	tradeChanged := false
	var ledger *ledgerRuntime
	if len(ledgers) > 0 {
		ledger = ledgers[0]
	}

	switch commandType {
	case "play":
		if session.Status == gen.ReplaySessionStatusCompleted {
			return nil, false, fmt.Errorf("%w: restart or seek before playing a completed session", ErrBadRequest)
		}
		if session.Status == gen.ReplaySessionStatusPaused {
			session.Status = gen.ReplaySessionStatusPlaying
			session.PauseReason = nil
		}
	case "pause", "__pause_no_subscribers", "__pause_server_restart":
		if session.Status == gen.ReplaySessionStatusPlaying {
			session.Status = gen.ReplaySessionStatusPaused
			reason := "manual"
			if commandType == "__pause_no_subscribers" {
				reason = "no_subscribers"
			} else if commandType == "__pause_server_restart" {
				reason = "server_restart"
			}
			session.PauseReason = &reason
		}
	case "step", "__clock_step":
		if commandType == "step" && session.Status != gen.ReplaySessionStatusPaused {
			return nil, false, fmt.Errorf("%w: step requires a paused session", ErrBadRequest)
		}
		if commandType == "__clock_step" && session.Status != gen.ReplaySessionStatusPlaying {
			return nil, false, nil
		}
		count, err := replayStepCount(input, commandType)
		if err != nil {
			return nil, false, err
		}
		targetTime := session.SimulatedTime.Time.Add(time.Duration(int64(session.ReplayIntervalSeconds)*int64(count)) * time.Second)
		completionTime := track.LastTime.Time
		if session.EndTime.Valid && session.EndTime.Time.Before(completionTime) {
			completionTime = session.EndTime.Time
		}
		if targetTime.After(completionTime) {
			targetTime = completionTime
		}
		selected, err := q.FindReplayDatasetBarAtOrBefore(ctx, gen.FindReplayDatasetBarAtOrBeforeParams{
			DatasetID: track.DatasetID, OpenTime: timestamp(targetTime),
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, false, err
		}
		if err == nil && selected.Seq > track.CursorSeq {
			rows, err := q.ListReplayDatasetBarsBySeqRange(ctx, gen.ListReplayDatasetBarsBySeqRangeParams{
				DatasetID: track.DatasetID, Seq: track.CursorSeq, Seq_2: selected.Seq,
			})
			if err != nil {
				return nil, false, err
			}
			state, err := currentAggregateState(ctx, q, track)
			if err != nil {
				return nil, false, err
			}
			source := make([]sourceBar, 0, len(rows))
			for _, row := range rows {
				source = append(source, sourceBarFromRow(row))
			}
			state, upserts, err := aggregateSourceBars(state, track.ChartTimeframe, source)
			if err != nil {
				return nil, false, err
			}
			track.AggregateState = marshalAggregateState(state)
			track.CursorSeq = selected.Seq
			track.VisibleThrough = selected.OpenTime
			drafts = appendReplayBarDrafts(
				drafts, uuidString(track.ID), coalesceBarUpserts(upserts),
				commandType == "__clock_step" && count > 1,
			)
			if ledger != nil {
				trading, err := ledger.processRows(ctx, track, rows)
				if err != nil {
					return nil, false, err
				}
				if len(trading) > 0 {
					tradeChanged = true
					drafts = append(drafts, trading...)
				}
			}
		}
		session.SimulatedTime = timestamp(targetTime)
		if !targetTime.Before(completionTime) {
			session.Status = gen.ReplaySessionStatusCompleted
			session.PauseReason = nil
		}
	case "set_speed":
		var body struct {
			Speed float64 `json:"speed"`
		}
		if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil || !finite(body.Speed) || body.Speed <= 0 || body.Speed > 100 {
			return nil, false, fmt.Errorf("%w: speed must be between 0 and 100", ErrBadRequest)
		}
		session.Speed = numeric(body.Speed)
	case "set_replay_interval":
		var body struct {
			ReplayInterval string `json:"replayInterval"`
		}
		if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil {
			return nil, false, fmt.Errorf("%w: invalid replay interval payload", ErrBadRequest)
		}
		_, chartSeconds, _ := normalizeTimeframe(track.ChartTimeframe)
		interval, err := resolveReplayInterval(body.ReplayInterval, track.ChartTimeframe, chartSeconds, int(track.BaseIntervalSeconds))
		if err != nil {
			return nil, false, err
		}
		session.ReplayIntervalSeconds = int32(interval)
	case "seek", "restart":
		target := session.StartTime.Time
		resetTrading := false
		if commandType == "seek" {
			var body struct {
				Time         time.Time `json:"time"`
				ResetTrading bool      `json:"resetTrading"`
			}
			if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil || body.Time.IsZero() {
				return nil, false, fmt.Errorf("%w: seek.time is required", ErrBadRequest)
			}
			target = body.Time.UTC()
			resetTrading = body.ResetTrading
		} else {
			var body struct {
				ResetTrading bool `json:"resetTrading"`
			}
			_ = json.Unmarshal(normalizedPayload(input.Payload), &body)
			resetTrading = body.ResetTrading
		}
		if ledger != nil && target.Before(session.SimulatedTime.Time) {
			hasFills, err := ledger.hasFills(ctx)
			if err != nil {
				return nil, false, err
			}
			if hasFills && !resetTrading {
				return nil, false, ErrRewindRequiresFork
			}
			if hasFills {
				resetEvents, err := ledger.reset(ctx, target)
				if err != nil {
					return nil, false, err
				}
				drafts = append(drafts, resetEvents...)
				tradeChanged = true
			}
		}
		if target.Before(track.FirstTime.Time) || !target.Before(track.LastTime.Time.Add(time.Duration(track.BaseIntervalSeconds)*time.Second)) {
			return nil, false, &DataUnavailableError{FirstAvailable: track.FirstTime.Time, LastAvailable: track.LastTime.Time.Add(time.Duration(track.BaseIntervalSeconds) * time.Second)}
		}
		selected, err := q.FindReplayDatasetBarAtOrBefore(ctx, gen.FindReplayDatasetBarAtOrBeforeParams{DatasetID: track.DatasetID, OpenTime: timestamp(target)})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, &DataUnavailableError{FirstAvailable: track.FirstTime.Time, LastAvailable: track.LastTime.Time.Add(time.Duration(track.BaseIntervalSeconds) * time.Second)}
		}
		if err != nil {
			return nil, false, err
		}
		rows, err := q.ListReplayDatasetBarsThroughSeq(ctx, gen.ListReplayDatasetBarsThroughSeqParams{DatasetID: track.DatasetID, Seq: selected.Seq})
		if err != nil {
			return nil, false, err
		}
		source := make([]sourceBar, 0, len(rows))
		for _, row := range rows {
			source = append(source, sourceBarFromRow(row))
		}
		_, state, err := aggregateRevealedBars(track.ChartTimeframe, source)
		if err != nil {
			return nil, false, err
		}
		track.CursorSeq = selected.Seq
		track.VisibleThrough = selected.OpenTime
		track.AggregateState = marshalAggregateState(state)
		session.SimulatedTime = selected.OpenTime
		session.Status = gen.ReplaySessionStatusPaused
		reason := commandType
		session.PauseReason = &reason
		drafts = append(drafts, eventDraft{typ: "track.reset", payload: map[string]any{
			"trackId": uuidString(track.ID), "cursorSeq": track.CursorSeq, "visibleThrough": track.VisibleThrough.Time,
		}})
	case "place_order", "cancel_order", "close_position", "update_order", "reset_trading":
		if ledger == nil {
			return nil, false, fmt.Errorf("%w: replay trading is unavailable", ErrBadRequest)
		}
		enabled, err := ledger.enabled(ctx)
		if err != nil {
			return nil, false, err
		}
		if !enabled {
			return nil, false, fmt.Errorf("%w: replay trading is disabled for this session", ErrBadRequest)
		}
		var tradeEvents []eventDraft
		switch commandType {
		case "place_order":
			bar, err := q.GetReplayDatasetBarBySeq(ctx, gen.GetReplayDatasetBarBySeqParams{DatasetID: track.DatasetID, Seq: track.CursorSeq})
			if err != nil {
				return nil, false, err
			}
			tradeEvents, err = ledger.place(ctx, track, session, bar, input.Payload)
		case "cancel_order":
			tradeEvents, err = ledger.cancel(ctx, input.Payload, session.SimulatedTime.Time)
		case "close_position":
			bar, barErr := q.GetReplayDatasetBarBySeq(ctx, gen.GetReplayDatasetBarBySeqParams{DatasetID: track.DatasetID, Seq: track.CursorSeq})
			if barErr != nil {
				return nil, false, barErr
			}
			tradeEvents, err = ledger.closePosition(ctx, track, session, bar, input.Payload)
		case "update_order":
			tradeEvents, err = ledger.updateBracket(ctx, input.Payload, session.SimulatedTime.Time)
		case "reset_trading":
			tradeEvents, err = ledger.reset(ctx, session.SimulatedTime.Time)
		}
		if err != nil {
			return nil, false, err
		}
		drafts = append(drafts, tradeEvents...)
		tradeChanged = true
	case "close":
		session.Status = gen.ReplaySessionStatusClosed
		reason := "closed"
		session.PauseReason = &reason
		session.ClosedAt = timestamp(time.Now().UTC())
	default:
		return nil, false, fmt.Errorf("%w: unsupported Phase 3 command %q", ErrBadRequest, input.Type)
	}

	newSpeed, _ := session.Speed.Float64Value()
	changed := oldStatus != session.Status || oldCursor != track.CursorSeq || oldSpeed.Float64 != newSpeed.Float64 ||
		oldReplayInterval != session.ReplayIntervalSeconds || !oldSimulated.Equal(session.SimulatedTime.Time) ||
		oldAggregate != string(track.AggregateState) || commandType == "close" || tradeChanged
	if !changed {
		return nil, false, nil
	}
	if oldCursor != track.CursorSeq {
		drafts = append(drafts, eventDraft{typ: "cursor.advanced", payload: map[string]any{
			"trackId": uuidString(track.ID), "cursorSeq": track.CursorSeq, "visibleThrough": track.VisibleThrough.Time,
		}})
	}
	timeChangedWithoutCursor := oldCursor == track.CursorSeq && !oldSimulated.Equal(session.SimulatedTime.Time)
	if oldStatus != session.Status || oldSpeed.Float64 != newSpeed.Float64 || oldReplayInterval != session.ReplayIntervalSeconds || timeChangedWithoutCursor || commandType == "close" {
		drafts = append(drafts, eventDraft{typ: "state.changed", payload: map[string]any{
			"status": string(session.Status), "speed": newSpeed.Float64, "pauseReason": session.PauseReason,
			"replayIntervalSeconds": session.ReplayIntervalSeconds,
		}})
	}
	return drafts, true, nil
}

func replayStepCount(input CommandInput, commandType string) (int, error) {
	count := 1
	if commandType == "step" || commandType == "__clock_step" {
		var body struct {
			Count int `json:"count"`
		}
		if err := json.Unmarshal(normalizedPayload(input.Payload), &body); err != nil {
			return 0, fmt.Errorf("%w: invalid step payload", ErrBadRequest)
		}
		if body.Count != 0 {
			count = body.Count
		}
	}
	if count < 1 || count > maxStepCount {
		return 0, fmt.Errorf("%w: step.count must be between 1 and %d", ErrBadRequest, maxStepCount)
	}
	return count, nil
}

func appendReplayBarDrafts(drafts []eventDraft, trackID string, bars []ReplayBar, batch bool) []eventDraft {
	if batch && len(bars) > 1 {
		return append(drafts, eventDraft{typ: "track.bars.batch", payload: map[string]any{
			"trackId": trackID, "bars": bars,
		}})
	}
	for _, bar := range bars {
		drafts = append(drafts, eventDraft{typ: "track.bar.upsert", payload: map[string]any{
			"trackId": trackID, "bar": bar,
		}})
	}
	return drafts
}

func currentAggregateState(ctx context.Context, q runtimeBarQueries, track *gen.ListReplayTracksForSessionForUpdateRow) (aggregateState, error) {
	state, err := parseAggregateState(track.AggregateState)
	if err == nil && state.LastSourceSeq == track.CursorSeq {
		return state, nil
	}
	rows, err := q.ListReplayDatasetBarsThroughSeq(ctx, gen.ListReplayDatasetBarsThroughSeqParams{DatasetID: track.DatasetID, Seq: track.CursorSeq})
	if err != nil {
		return aggregateState{}, err
	}
	source := make([]sourceBar, 0, len(rows))
	for _, row := range rows {
		source = append(source, sourceBarFromRow(row))
	}
	_, state, err = aggregateRevealedBars(track.ChartTimeframe, source)
	return state, err
}

func duplicateCommandResult(command gen.ReplayCommand) (CommandResult, []EventEnvelope, error) {
	if command.Status == gen.ReplayCommandStatusRejected {
		var rejection commandRejection
		_ = json.Unmarshal(command.Result, &rejection)
		if rejection.Code == "version_conflict" {
			return CommandResult{}, nil, &VersionConflictError{CurrentVersion: rejection.CurrentVersion}
		}
		if rejection.Code == "session_closed" {
			return CommandResult{}, nil, ErrSessionClosed
		}
	}
	var result CommandResult
	if err := json.Unmarshal(command.Result, &result); err != nil {
		return CommandResult{}, nil, err
	}
	result.Duplicate = true
	return result, nil, nil
}

func snapshotWithQueries(ctx context.Context, q *gen.Queries, db tradingDB, uid, sid pgtype.UUID) (SessionSnapshot, error) {
	session, err := q.GetReplaySessionForUser(ctx, gen.GetReplaySessionForUserParams{ID: sid, UserID: uid})
	if err != nil {
		return SessionSnapshot{}, err
	}
	tracks, err := q.ListReplayTracksForSession(ctx, sid)
	if err != nil {
		return SessionSnapshot{}, err
	}
	out := sessionSnapshot(session)
	out.Tracks = make([]TrackSnapshot, 0, len(tracks))
	for _, track := range tracks {
		out.Tracks = append(out.Tracks, snapshotTrack(track))
	}
	out.Trading, err = loadTradingSnapshot(ctx, db, sid)
	if err != nil {
		return SessionSnapshot{}, err
	}
	return out, nil
}

func (r *Repo) Events(ctx context.Context, userID, sessionID string, afterSeq int64, limit int32) ([]EventEnvelope, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return nil, ErrNotFound
	}
	if _, err := r.queries.GetReplaySessionForUser(ctx, gen.GetReplaySessionForUserParams{ID: sid, UserID: uid}); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if afterSeq < 0 {
		afterSeq = 0
	}
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	rows, err := r.queries.ListReplayEventsForUser(ctx, gen.ListReplayEventsForUserParams{SessionID: sid, UserID: uid, EventSeq: afterSeq, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]EventEnvelope, 0, len(rows))
	for _, row := range rows {
		out = append(out, eventEnvelope(row))
	}
	return out, nil
}

func (r *Repo) VerifyLatestCheckpoint(ctx context.Context, userID, sessionID string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return ErrNotFound
	}
	checkpoint, err := r.queries.GetLatestReplayCheckpoint(ctx, gen.GetLatestReplayCheckpointParams{SessionID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var snapshot SessionSnapshot
	if err := json.Unmarshal(checkpoint.Snapshot, &snapshot); err != nil {
		return ErrCheckpointCorrupt
	}
	sum := sha256.Sum256(resultJSONForCheckpoint(snapshot))
	if hex.EncodeToString(sum[:]) != checkpoint.ChecksumSha256 {
		return ErrCheckpointCorrupt
	}
	return nil
}

func (r *Repo) PlayingSessions(ctx context.Context) ([][2]string, error) {
	rows, err := r.queries.ListPlayingReplaySessions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([][2]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, [2]string{uuidString(row.UserID), uuidString(row.ID)})
	}
	return out, nil
}

func eventEnvelope(row gen.ReplayEvent) EventEnvelope {
	return EventEnvelope{SessionID: uuidString(row.SessionID), EventSeq: row.EventSeq, Version: row.Version,
		SimulatedTime: row.SimulatedAt.Time, Type: row.EventType, Payload: json.RawMessage(row.Payload)}
}

func normalizedPayload(payload json.RawMessage) []byte {
	if len(payload) == 0 || string(payload) == "null" {
		return []byte("{}")
	}
	return payload
}

func resultJSONForCheckpoint(snapshot SessionSnapshot) []byte {
	payload, _ := json.Marshal(snapshot)
	return payload
}
