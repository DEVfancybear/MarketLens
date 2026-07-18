package pineruntime

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

const (
	defaultRuntimeCacheEntries = 64
	defaultRuntimeWorkers      = 4
)

var errRuntimeQueueFull = errors.New("runtime job queue is full")

// runtimeJobGroup is the common asynchronous execution boundary for runtime
// calculations. A fixed worker pool and bounded queue prevent request bursts
// from creating unbounded goroutines. Equal requests share one job, and
// completed results live in a bounded LRU so saved Pine scripts and catalog
// indicators do not repeatedly compile the same candle window.
//
// A job uses its own bounded context. A disconnected HTTP caller therefore
// stops waiting without cancelling work that another caller is still using.
type runtimeJobGroup[T any] struct {
	maxEntries int
	timeout    timeouter

	mu       sync.Mutex
	entries  map[string]*list.Element
	order    list.List
	inflight map[string]*runtimeJobCall[T]
	queue    chan runtimeJobTask[T]
	workers  int
}

type runtimeJobEntry[T any] struct {
	key   string
	value T
}

type runtimeJobCall[T any] struct {
	done  chan struct{}
	value T
	err   error
}

type runtimeJobTask[T any] struct {
	key  string
	call *runtimeJobCall[T]
	work func(context.Context) (T, error)
}

func newRuntimeJobGroup[T any](maxEntries int, timeout timeouter) *runtimeJobGroup[T] {
	if maxEntries < 1 {
		maxEntries = defaultRuntimeCacheEntries
	}
	workers := defaultRuntimeWorkers
	if workers > maxEntries {
		workers = maxEntries
	}
	group := &runtimeJobGroup[T]{
		maxEntries: maxEntries,
		timeout:    timeout,
		entries:    make(map[string]*list.Element, maxEntries),
		inflight:   map[string]*runtimeJobCall[T]{},
		queue:      make(chan runtimeJobTask[T], maxEntries),
		workers:    workers,
	}
	for worker := 0; worker < workers; worker++ {
		go group.worker()
	}
	return group
}

func (g *runtimeJobGroup[T]) Do(
	ctx context.Context,
	key string,
	work func(context.Context) (T, error),
) (T, error) {
	if err := ctx.Err(); err != nil {
		var zero T
		return zero, err
	}
	if key == "" {
		return runRuntimeJob(ctx, g.timeout, work)
	}

	g.mu.Lock()
	if element, ok := g.entries[key]; ok {
		g.order.MoveToBack(element)
		value := element.Value.(runtimeJobEntry[T]).value
		g.mu.Unlock()
		return value, nil
	}
	if call, ok := g.inflight[key]; ok {
		g.mu.Unlock()
		return waitRuntimeJob(ctx, call)
	}
	if len(g.inflight) >= g.workers+cap(g.queue) {
		g.mu.Unlock()
		var zero T
		return zero, errRuntimeQueueFull
	}
	if err := ctx.Err(); err != nil {
		g.mu.Unlock()
		var zero T
		return zero, err
	}
	call := &runtimeJobCall[T]{done: make(chan struct{})}
	task := runtimeJobTask[T]{key: key, call: call, work: work}
	select {
	case g.queue <- task:
		// Publish only after the bounded queue accepts the task. A worker may
		// receive it immediately, but finish blocks on mu until the call is
		// visible. From this point caller cancellation only stops waiting and
		// cannot cancel work shared by another caller.
		g.inflight[key] = call
		g.mu.Unlock()
	default:
		g.mu.Unlock()
		var zero T
		return zero, errRuntimeQueueFull
	}
	return waitRuntimeJob(ctx, call)
}

func (g *runtimeJobGroup[T]) worker() {
	for task := range g.queue {
		g.execute(task)
	}
}

func (g *runtimeJobGroup[T]) execute(task runtimeJobTask[T]) {
	jobCtx, cancel := g.timeout.WithTimeout(context.Background())
	defer cancel()

	var value T
	var err error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				err = fmt.Errorf("runtime job panicked: %v", recovered)
			}
		}()
		value, err = task.work(jobCtx)
	}()
	g.finish(task, value, err)
}

func (g *runtimeJobGroup[T]) finish(task runtimeJobTask[T], value T, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if current := g.inflight[task.key]; current != task.call {
		return
	}
	delete(g.inflight, task.key)
	task.call.value = value
	task.call.err = err
	if err == nil {
		g.storeLocked(task.key, value)
	}
	close(task.call.done)
}

func (g *runtimeJobGroup[T]) storeLocked(key string, value T) {
	if element, ok := g.entries[key]; ok {
		element.Value = runtimeJobEntry[T]{key: key, value: value}
		g.order.MoveToBack(element)
		return
	}
	element := g.order.PushBack(runtimeJobEntry[T]{key: key, value: value})
	g.entries[key] = element
	for len(g.entries) > g.maxEntries {
		oldest := g.order.Front()
		if oldest == nil {
			break
		}
		entry := oldest.Value.(runtimeJobEntry[T])
		delete(g.entries, entry.key)
		g.order.Remove(oldest)
	}
}

func runRuntimeJob[T any](
	ctx context.Context,
	timeout timeouter,
	work func(context.Context) (T, error),
) (T, error) {
	call := &runtimeJobCall[T]{done: make(chan struct{})}
	go func() {
		jobCtx, cancel := timeout.WithTimeout(context.Background())
		defer cancel()
		defer close(call.done)
		defer func() {
			if recovered := recover(); recovered != nil {
				call.err = fmt.Errorf("runtime job panicked: %v", recovered)
			}
		}()
		call.value, call.err = work(jobCtx)
	}()
	return waitRuntimeJob(ctx, call)
}

func waitRuntimeJob[T any](ctx context.Context, call *runtimeJobCall[T]) (T, error) {
	select {
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case <-call.done:
		return call.value, call.err
	}
}

func compileRuntimeKey(req CompileRequest) (string, error) {
	candles := normalizeRuntimeCandles(req.Candles)
	if err := validateReplayCutoff(req.ReplayCutoff); err != nil {
		return "", err
	}
	if req.ReplayCutoff != nil {
		candles = candlesThroughReplayCutoff(candles, *req.ReplayCutoff)
	}
	truncated := len(candles) > maxCompileCandles
	if len(candles) > maxCompileCandles {
		candles = candles[len(candles)-maxCompileCandles:]
	}
	// ScriptID is deliberately excluded: source and properties define the
	// calculation. This lets equivalent scripts saved by different users share
	// work while the handler rebinds the result to each chart instance ID.
	return hashRuntimeRequest(struct {
		SourceCode     string                `json:"sourceCode"`
		Timeframe      string                `json:"timeframe,omitempty"`
		Candles        []Candle              `json:"candles"`
		Truncated      bool                  `json:"truncated,omitempty"`
		InputOverrides map[string]InputValue `json:"inputOverrides,omitempty"`
		StyleOverrides map[string]InputValue `json:"styleOverrides,omitempty"`
		ReplayCutoff   *int64                `json:"replayCutoff,omitempty"`
	}{
		SourceCode:     req.SourceCode,
		Timeframe:      req.Timeframe,
		Candles:        candles,
		Truncated:      truncated,
		InputOverrides: req.InputOverrides,
		StyleOverrides: req.StyleOverrides,
		ReplayCutoff:   req.ReplayCutoff,
	})
}

func indicatorRuntimeKey(req IndicatorRuntimeRequest) (string, error) {
	candles := normalizeRuntimeCandles(req.Candles)
	if err := validateReplayCutoff(req.ReplayCutoff); err != nil {
		return "", err
	}
	if req.ReplayCutoff != nil {
		candles = candlesThroughReplayCutoff(candles, *req.ReplayCutoff)
	}
	truncated := len(candles) > maxCompileCandles
	if len(candles) > maxCompileCandles {
		candles = candles[len(candles)-maxCompileCandles:]
	}
	// IndicatorID is an instance identity rather than calculator input.
	return hashRuntimeRequest(struct {
		IndicatorType string         `json:"indicatorType"`
		SourceCode    string         `json:"sourceCode,omitempty"`
		Timeframe     string         `json:"timeframe,omitempty"`
		Config        map[string]any `json:"config,omitempty"`
		Candles       []Candle       `json:"candles"`
		Truncated     bool           `json:"truncated,omitempty"`
		ReplayCutoff  *int64         `json:"replayCutoff,omitempty"`
	}{
		IndicatorType: req.IndicatorType,
		SourceCode:    indicatorSourceCode(req),
		Timeframe:     req.Timeframe,
		Config:        runtimeConfigForKey(req.Config),
		Candles:       candles,
		Truncated:     truncated,
		ReplayCutoff:  req.ReplayCutoff,
	})
}

func runtimeConfigForKey(config map[string]any) map[string]any {
	if len(config) == 0 {
		return nil
	}
	canonical := make(map[string]any, len(config))
	for key, value := range config {
		switch key {
		case "id", "indicatorId", "clientId":
			// Instance identity must not prevent equivalent calculations from
			// sharing the common runtime job.
			continue
		case "sourceCode":
			// Source is canonicalized and hashed as a top-level runtime field.
			continue
		default:
			canonical[key] = value
		}
	}
	return canonical
}

func hashRuntimeRequest(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}
