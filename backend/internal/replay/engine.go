package replay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RuntimeStore interface {
	ApplyCommand(context.Context, string, string, CommandInput) (CommandResult, []EventEnvelope, error)
	Get(context.Context, string, string) (SessionSnapshot, error)
	Events(context.Context, string, string, int64, int32) ([]EventEnvelope, error)
	VerifyLatestCheckpoint(context.Context, string, string) error
	PlayingSessions(context.Context) ([][2]string, error)
	RenewActorLease(context.Context, string, string, time.Time) (bool, error)
	ReleaseActorLease(context.Context, string, string) error
}

type Engine struct {
	store    RuntimeStore
	grace    time.Duration
	owner    string
	leaseTTL time.Duration

	ctx         context.Context
	mu          sync.Mutex
	actors      map[string]*sessionActor
	subs        map[string]map[*Subscription]struct{}
	pauseTimers map[string]*time.Timer
}

func NewEngine(store RuntimeStore, disconnectGrace time.Duration, actorLeaseTTL ...time.Duration) *Engine {
	if disconnectGrace <= 0 {
		disconnectGrace = 5 * time.Second
	}
	leaseTTL := 5 * time.Second
	if len(actorLeaseTTL) > 0 && actorLeaseTTL[0] > 0 {
		leaseTTL = actorLeaseTTL[0]
	}
	if leaseTTL < 2*time.Second {
		leaseTTL = 2 * time.Second
	}
	return &Engine{store: store, grace: disconnectGrace, owner: newActorOwner(), leaseTTL: leaseTTL,
		ctx: context.Background(), actors: map[string]*sessionActor{},
		subs: map[string]map[*Subscription]struct{}{}, pauseTimers: map[string]*time.Timer{}}
}

func newActorOwner() string {
	var random [12]byte
	if _, err := rand.Read(random[:]); err == nil {
		return "replay-" + hex.EncodeToString(random[:])
	}
	return "replay-" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36)
}

func (e *Engine) Start(ctx context.Context) error {
	e.ctx = ctx
	playing, err := e.store.PlayingSessions(ctx)
	if err != nil {
		return err
	}
	stamp := strconv.FormatInt(time.Now().UTC().UnixNano(), 36)
	for _, item := range playing {
		input := CommandInput{IdempotencyKey: "server-restart:" + stamp, Type: "__pause_server_restart"}
		if _, _, err := e.store.ApplyCommand(ctx, item[0], item[1], input); err != nil {
			if err == ErrSessionBusy {
				go e.retryRestartRecovery(ctx, item[0], item[1], input)
				continue
			}
			if !isBenignRecoveryError(err) {
				return fmt.Errorf("replay: pause playing session %s on startup: %w", item[1], err)
			}
		}
	}
	return nil
}

func (e *Engine) retryRestartRecovery(ctx context.Context, userID, sessionID string, input CommandInput) {
	ticker := time.NewTicker(e.leaseTTL / 2)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _, err := e.store.ApplyCommand(ctx, userID, sessionID, input)
			if err == ErrSessionBusy {
				continue
			}
			return
		}
	}
}

func isBenignRecoveryError(err error) bool {
	return err == ErrSessionClosed || err == ErrNotFound || err == ErrSessionBusy
}

func (e *Engine) Command(ctx context.Context, userID, sessionID string, input CommandInput) (CommandResult, error) {
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Type = strings.TrimSpace(input.Type)
	if err := validateCommandEnvelope(input); err != nil {
		return CommandResult{}, err
	}
	actor, err := e.actor(ctx, userID, sessionID)
	if err != nil {
		return CommandResult{}, err
	}
	return actor.command(ctx, input)
}

func (e *Engine) Close(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	snapshot, err := e.store.Get(ctx, userID, sessionID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	if snapshot.Status == "closed" {
		return snapshot, nil
	}
	version := snapshot.Version
	result, err := e.Command(ctx, userID, sessionID, CommandInput{
		IdempotencyKey: "delete:v" + strconv.FormatInt(version, 10), ExpectedVersion: &version, Type: "close",
	})
	if err != nil {
		return SessionSnapshot{}, err
	}
	return result.Snapshot, nil
}

func (e *Engine) Events(ctx context.Context, userID, sessionID string, afterSeq int64, limit int32) ([]EventEnvelope, error) {
	return e.store.Events(ctx, userID, sessionID, afterSeq, limit)
}

func (e *Engine) Subscribe(ctx context.Context, userID, sessionID string) (SessionSnapshot, *Subscription, error) {
	if _, err := e.actor(ctx, userID, sessionID); err != nil {
		return SessionSnapshot{}, nil, err
	}
	sub := &Subscription{engine: e, userID: userID, sessionID: sessionID, events: make(chan EventEnvelope, 128), done: make(chan struct{})}
	e.mu.Lock()
	if timer := e.pauseTimers[sessionID]; timer != nil {
		timer.Stop()
		delete(e.pauseTimers, sessionID)
	}
	if e.subs[sessionID] == nil {
		e.subs[sessionID] = map[*Subscription]struct{}{}
	}
	e.subs[sessionID][sub] = struct{}{}
	e.mu.Unlock()
	snapshot, err := e.store.Get(ctx, userID, sessionID)
	if err != nil {
		sub.Close()
		return SessionSnapshot{}, nil, err
	}
	return snapshot, sub, nil
}

func (e *Engine) actor(ctx context.Context, userID, sessionID string) (*sessionActor, error) {
	key := userID + ":" + sessionID
	e.mu.Lock()
	if actor := e.actors[key]; actor != nil {
		e.mu.Unlock()
		return actor, nil
	}
	e.mu.Unlock()
	if err := e.store.VerifyLatestCheckpoint(ctx, userID, sessionID); err != nil {
		return nil, err
	}
	snapshot, err := e.store.Get(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	actor := newSessionActor(e, userID, sessionID, snapshot)
	e.mu.Lock()
	if existing := e.actors[key]; existing != nil {
		e.mu.Unlock()
		return existing, nil
	}
	e.actors[key] = actor
	e.mu.Unlock()
	go actor.run(e.ctx)
	return actor, nil
}

func (e *Engine) removeActor(actor *sessionActor) {
	key := actor.userID + ":" + actor.sessionID
	e.mu.Lock()
	if e.actors[key] == actor {
		delete(e.actors, key)
	}
	e.mu.Unlock()
}

func (e *Engine) publish(events []EventEnvelope) {
	for _, event := range events {
		e.mu.Lock()
		var slow []*Subscription
		for sub := range e.subs[event.SessionID] {
			select {
			case sub.events <- event:
			default:
				slow = append(slow, sub)
			}
		}
		e.mu.Unlock()
		for _, sub := range slow {
			sub.Close()
		}
	}
}

func (e *Engine) subscriberClosed(sub *Subscription) {
	e.mu.Lock()
	delete(e.subs[sub.sessionID], sub)
	remaining := len(e.subs[sub.sessionID])
	if remaining == 0 {
		delete(e.subs, sub.sessionID)
		if timer := e.pauseTimers[sub.sessionID]; timer != nil {
			timer.Stop()
		}
		e.pauseTimers[sub.sessionID] = time.AfterFunc(e.grace, func() {
			e.pauseForNoSubscribers(sub.userID, sub.sessionID)
		})
	}
	e.mu.Unlock()
}

func (e *Engine) schedulePauseIfUnobserved(userID, sessionID string) {
	e.mu.Lock()
	if len(e.subs[sessionID]) == 0 && e.pauseTimers[sessionID] == nil {
		e.pauseTimers[sessionID] = time.AfterFunc(e.grace, func() { e.pauseForNoSubscribers(userID, sessionID) })
	}
	e.mu.Unlock()
}

func (e *Engine) pauseForNoSubscribers(userID, sessionID string) {
	e.mu.Lock()
	if len(e.subs[sessionID]) > 0 {
		delete(e.pauseTimers, sessionID)
		e.mu.Unlock()
		return
	}
	delete(e.pauseTimers, sessionID)
	e.mu.Unlock()
	actor, err := e.actor(context.Background(), userID, sessionID)
	if err != nil {
		return
	}
	_, _ = actor.command(context.Background(), CommandInput{
		IdempotencyKey: "no-subscribers:" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36), Type: "__pause_no_subscribers",
	})
}

func validateCommandEnvelope(input CommandInput) error {
	if len(input.IdempotencyKey) == 0 || len(input.IdempotencyKey) > 200 {
		return fmt.Errorf("%w: idempotencyKey must contain 1 to 200 characters", ErrBadRequest)
	}
	if input.Type == "" || strings.HasPrefix(input.Type, "__") {
		return fmt.Errorf("%w: command type is required", ErrBadRequest)
	}
	return nil
}

type actorRequest struct {
	ctx    context.Context
	input  CommandInput
	result chan actorResponse
}
type actorResponse struct {
	result CommandResult
	err    error
}

type sessionActor struct {
	engine            *Engine
	userID, sessionID string
	requests          chan actorRequest
	done              chan struct{}
	snapshot          SessionSnapshot
	timer             *time.Timer
	heartbeat         *time.Timer
	tick              int64
	clockAnchor       time.Time
}

func newSessionActor(engine *Engine, userID, sessionID string, snapshot SessionSnapshot) *sessionActor {
	return &sessionActor{engine: engine, userID: userID, sessionID: sessionID, requests: make(chan actorRequest), done: make(chan struct{}), snapshot: snapshot}
}

func (a *sessionActor) command(ctx context.Context, input CommandInput) (CommandResult, error) {
	response := make(chan actorResponse, 1)
	request := actorRequest{ctx: ctx, input: input, result: response}
	select {
	case a.requests <- request:
	case <-a.done:
		return CommandResult{}, context.Canceled
	case <-ctx.Done():
		return CommandResult{}, ctx.Err()
	}
	select {
	case got := <-response:
		return got.result, got.err
	case <-a.done:
		return CommandResult{}, context.Canceled
	case <-ctx.Done():
		return CommandResult{}, ctx.Err()
	}
}

func (a *sessionActor) run(ctx context.Context) {
	defer func() {
		a.stopTimers()
		a.releaseOwnership()
		close(a.done)
	}()
	for {
		var tick <-chan time.Time
		var heartbeat <-chan time.Time
		if a.timer != nil {
			tick = a.timer.C
		}
		if a.heartbeat != nil {
			heartbeat = a.heartbeat.C
		}
		select {
		case <-ctx.Done():
			return
		case request := <-a.requests:
			previousStatus := a.snapshot.Status
			previousSpeed := a.snapshot.Speed
			result, events, err := a.apply(request.ctx, request.input)
			if err == nil && !result.Duplicate {
				a.snapshot = result.Snapshot
				startedFastPlayback := previousStatus != "playing" && a.snapshot.Status == "playing" && a.snapshot.Speed >= 1
				if a.snapshot.Status != "playing" {
					a.clockAnchor = time.Time{}
				} else if startedFastPlayback {
					a.clockAnchor = time.Now().Add(-time.Second)
				} else if previousStatus != "playing" || previousSpeed != a.snapshot.Speed {
					a.clockAnchor = time.Now()
				}
				a.engine.publish(events)
				if startedFastPlayback {
					a.resetTimersAfter(replayClockCadence(a.snapshot.Speed) - 16*time.Millisecond)
				} else {
					a.resetTimers()
				}
				if a.snapshot.Status == "playing" {
					a.engine.schedulePauseIfUnobserved(a.userID, a.sessionID)
				}
			}
			request.result <- actorResponse{result: result, err: err}
			if err == nil && (a.snapshot.Status == "closed" || request.input.Type == "__pause_no_subscribers") {
				a.engine.removeActor(a)
				return
			}
		case <-tick:
			startedAt := time.Now()
			a.tick++
			elapsed := time.Second
			if !a.clockAnchor.IsZero() {
				elapsed = startedAt.Sub(a.clockAnchor)
			}
			count := replayClockStepCount(a.snapshot.Speed, elapsed)
			payload, _ := json.Marshal(map[string]int{"count": count})
			input := CommandInput{IdempotencyKey: fmt.Sprintf("clock:%s:%d:%d", a.sessionID, a.snapshot.Version, a.tick), Type: "__clock_step", Payload: payload}
			result, events, err := a.apply(ctx, input)
			if err == nil && !result.Duplicate {
				a.snapshot = result.Snapshot
				if a.snapshot.Status == "playing" {
					a.clockAnchor = startedAt
				} else {
					a.clockAnchor = time.Time{}
				}
				a.engine.publish(events)
			}
			a.resetTimersAfter(time.Since(startedAt))
		case <-heartbeat:
			leaseUntil := time.Now().UTC().Add(a.engine.leaseTTL)
			owned, err := a.engine.store.RenewActorLease(ctx, a.engine.owner, a.sessionID, leaseUntil)
			if err != nil || !owned {
				a.engine.removeActor(a)
				return
			}
			a.resetHeartbeat()
		}
	}
}

func (a *sessionActor) apply(ctx context.Context, input CommandInput) (CommandResult, []EventEnvelope, error) {
	needsOwnership := a.snapshot.Status == "playing" || input.Type == "play" || input.Type == "__clock_step"
	if needsOwnership {
		input.ActorOwner = a.engine.owner
		input.ActorLeaseUntil = time.Now().UTC().Add(a.engine.leaseTTL)
	}
	input.RuntimeTrading = a.snapshot.Trading
	return a.engine.store.ApplyCommand(ctx, a.userID, a.sessionID, input)
}

func (a *sessionActor) releaseOwnership() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = a.engine.store.ReleaseActorLease(ctx, a.engine.owner, a.sessionID)
}

func (a *sessionActor) resetTimers() {
	a.resetTimersAfter(0)
}

func (a *sessionActor) resetTimersAfter(elapsed time.Duration) {
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
	if a.snapshot.Status != "playing" {
		if a.heartbeat != nil {
			a.heartbeat.Stop()
			a.heartbeat = nil
		}
		return
	}
	delay := replayClockCadence(a.snapshot.Speed) - elapsed
	if delay < 16*time.Millisecond {
		delay = 16 * time.Millisecond
	}
	a.timer = time.NewTimer(delay)
	a.resetHeartbeat()
}

func replayClockCadence(speed float64) time.Duration {
	if speed >= 1 {
		return time.Second
	}
	return time.Duration(float64(time.Second) / speed)
}

func replayClockStepCount(speed float64, elapsed ...time.Duration) int {
	if speed < 1 {
		return 1
	}
	seconds := 1.0
	if len(elapsed) > 0 && elapsed[0] > 0 {
		seconds = elapsed[0].Seconds()
	}
	return min(max(int(math.Round(speed*seconds)), 1), 100)
}

func (a *sessionActor) resetHeartbeat() {
	if a.heartbeat != nil {
		a.heartbeat.Stop()
	}
	a.heartbeat = time.NewTimer(a.engine.leaseTTL / 2)
}

func (a *sessionActor) stopTimers() {
	if a.timer != nil {
		a.timer.Stop()
	}
	if a.heartbeat != nil {
		a.heartbeat.Stop()
	}
}

type Subscription struct {
	engine            *Engine
	userID, sessionID string
	events            chan EventEnvelope
	done              chan struct{}
	once              sync.Once
}

func (s *Subscription) Events() <-chan EventEnvelope { return s.events }
func (s *Subscription) Done() <-chan struct{}        { return s.done }
func (s *Subscription) Close()                       { s.once.Do(func() { close(s.done); s.engine.subscriberClosed(s) }) }
