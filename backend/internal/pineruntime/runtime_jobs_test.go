package pineruntime

import (
	"container/list"
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestCompileRuntimeKeySharesSavedScriptWorkAcrossInstanceIDs(t *testing.T) {
	base := CompileRequest{
		ScriptID:   "owner-a-script",
		SourceCode: `indicator("Shared"); plot(close)`,
		Candles:    sampleCandles(20),
		InputOverrides: map[string]InputValue{
			"length": float64(14),
			"show":   true,
		},
	}
	other := base
	other.ScriptID = "owner-b-script"

	baseKey, err := compileRuntimeKey(base)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, err := compileRuntimeKey(other)
	if err != nil {
		t.Fatal(err)
	}
	if baseKey != otherKey {
		t.Fatalf("instance IDs should not split shared compile work: %q != %q", baseKey, otherKey)
	}

	other.InputOverrides = map[string]InputValue{"length": float64(21), "show": true}
	changedKey, err := compileRuntimeKey(other)
	if err != nil {
		t.Fatal(err)
	}
	if changedKey == baseKey {
		t.Fatal("input properties must be part of the compile cache key")
	}
}

func TestIndicatorRuntimeKeySharesInstanceIdentity(t *testing.T) {
	base := IndicatorRuntimeRequest{
		IndicatorType: "FVG",
		IndicatorID:   "instance-a",
		Config: map[string]any{
			"id": "instance-a", "type": "FVG",
			"inputValues": map[string]any{"maxZones": 20},
		},
		Candles: sampleCandles(20),
	}
	other := base
	other.IndicatorID = "instance-b"
	other.Config = map[string]any{
		"id": "instance-b", "type": "FVG",
		"inputValues": map[string]any{"maxZones": 20},
	}
	firstKey, err := indicatorRuntimeKey(base)
	if err != nil {
		t.Fatal(err)
	}
	secondKey, err := indicatorRuntimeKey(other)
	if err != nil {
		t.Fatal(err)
	}
	if firstKey != secondKey {
		t.Fatalf("indicator instance identity split equivalent work: %q != %q", firstKey, secondKey)
	}
}

func TestRuntimeJobGroupCoalescesConcurrentSavedScriptCompiles(t *testing.T) {
	group := newRuntimeJobGroup[int](4, runtimeTimeout{})
	const callers = 12
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	work := func(context.Context) (int, error) {
		calls.Add(1)
		select {
		case <-started:
		default:
			close(started)
		}
		<-release
		return 42, nil
	}

	gate := make(chan struct{})
	results := make(chan int, callers)
	var ready sync.WaitGroup
	ready.Add(callers)
	for range callers {
		go func() {
			ready.Done()
			<-gate
			value, err := group.Do(context.Background(), "same-source-and-window", work)
			if err != nil {
				results <- -1
				return
			}
			results <- value
		}()
	}
	ready.Wait()
	close(gate)
	<-started
	close(release)

	for range callers {
		if value := <-results; value != 42 {
			t.Fatalf("runtime result = %d, want 42", value)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("runtime work executed %d times, want 1", got)
	}

	value, err := group.Do(context.Background(), "same-source-and-window", func(context.Context) (int, error) {
		calls.Add(1)
		return 99, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if value != 42 || calls.Load() != 1 {
		t.Fatalf("completed result was not cached: value=%d calls=%d", value, calls.Load())
	}
}

func TestRuntimeJobGroupBoundsCompletedResults(t *testing.T) {
	group := newRuntimeJobGroup[int](2, runtimeTimeout{})
	for index, key := range []string{"one", "two", "three"} {
		value, err := group.Do(context.Background(), key, func(context.Context) (int, error) {
			return index, nil
		})
		if err != nil || value != index {
			t.Fatalf("store %q: value=%d err=%v", key, value, err)
		}
	}
	group.mu.Lock()
	defer group.mu.Unlock()
	if len(group.entries) != 2 {
		t.Fatalf("cache entries = %d, want 2", len(group.entries))
	}
	if _, exists := group.entries["one"]; exists {
		t.Fatal("least-recently-used entry was not evicted")
	}
}

func TestRuntimeJobGroupRejectsCanceledCallerBeforeCacheLookup(t *testing.T) {
	group := newRuntimeJobGroup[int](2, runtimeTimeout{})
	if _, err := group.Do(context.Background(), "cached", func(context.Context) (int, error) {
		return 42, nil
	}); err != nil {
		t.Fatal(err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	value, err := group.Do(canceled, "cached", func(context.Context) (int, error) {
		t.Fatal("cached canceled request must not execute work")
		return 0, nil
	})
	if err != context.Canceled || value != 0 {
		t.Fatalf("canceled cache lookup = (%d, %v), want (0, context.Canceled)", value, err)
	}
	if _, err := group.Do(canceled, "missing", func(context.Context) (int, error) {
		t.Fatal("canceled cache miss must not execute work")
		return 0, nil
	}); err != context.Canceled {
		t.Fatalf("canceled cache miss error = %v", err)
	}
	group.mu.Lock()
	inflight := len(group.inflight)
	group.mu.Unlock()
	if inflight != 0 {
		t.Fatalf("canceled miss left %d inflight jobs", inflight)
	}
}

func TestRuntimeJobGroupBoundsWorkersAndQueue(t *testing.T) {
	group := newRuntimeJobGroup[int](1, runtimeTimeout{})
	release := make(chan struct{})
	started := make(chan string, 2)
	results := make(chan error, 2)
	work := func(key string) func(context.Context) (int, error) {
		return func(context.Context) (int, error) {
			started <- key
			<-release
			return 1, nil
		}
	}
	go func() {
		_, err := group.Do(context.Background(), "running", work("running"))
		results <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first worker did not start")
	}
	go func() {
		_, err := group.Do(context.Background(), "queued", work("queued"))
		results <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		group.mu.Lock()
		count := len(group.inflight)
		group.mu.Unlock()
		if count == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("queued job was not registered; inflight=%d", count)
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := group.Do(context.Background(), "overflow", work("overflow")); !errors.Is(err, errRuntimeQueueFull) {
		t.Fatalf("overflow error = %v, want errRuntimeQueueFull", err)
	}
	if len(started) != 0 {
		t.Fatal("more work started than the worker bound allows")
	}
	close(release)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestRuntimeJobGroupDoesNotPublishCallBeforeQueueAdmission(t *testing.T) {
	group := &runtimeJobGroup[int]{
		maxEntries: 1,
		timeout:    runtimeTimeout{},
		entries:    map[string]*list.Element{},
		inflight:   map[string]*runtimeJobCall[int]{},
		queue:      make(chan runtimeJobTask[int], 1),
		workers:    1,
	}
	blockerCall := &runtimeJobCall[int]{done: make(chan struct{})}
	blocker := runtimeJobTask[int]{
		key:  "blocker",
		call: blockerCall,
		work: func(context.Context) (int, error) { return 1, nil },
	}
	group.inflight[blocker.key] = blockerCall
	group.queue <- blocker

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := group.Do(ctx, "shared", func(context.Context) (int, error) {
		t.Fatal("queue-rejected task must not execute")
		return 0, nil
	}); !errors.Is(err, errRuntimeQueueFull) {
		t.Fatalf("queue admission error = %v, want errRuntimeQueueFull", err)
	}
	group.mu.Lock()
	_, published := group.inflight["shared"]
	group.mu.Unlock()
	if published {
		t.Fatal("queue-rejected call was published for coalescing")
	}
}

func TestRuntimeJobGroupCreatorCancellationDoesNotCancelSharedAdmittedWork(t *testing.T) {
	// Hold the admitted task in the queue so a second caller can share it
	// before the worker starts.
	group := &runtimeJobGroup[int]{
		maxEntries: 1,
		timeout:    runtimeTimeout{},
		entries:    map[string]*list.Element{},
		inflight:   map[string]*runtimeJobCall[int]{},
		queue:      make(chan runtimeJobTask[int], 1),
		workers:    1,
	}
	creatorCtx, cancelCreator := context.WithCancel(context.Background())
	creatorDone := make(chan error, 1)
	workStarted := make(chan struct{})
	go func() {
		_, err := group.Do(creatorCtx, "shared", func(context.Context) (int, error) {
			close(workStarted)
			return 42, nil
		})
		creatorDone <- err
	}()

	var sharedCall *runtimeJobCall[int]
	deadline := time.Now().Add(time.Second)
	for sharedCall == nil {
		group.mu.Lock()
		sharedCall = group.inflight["shared"]
		group.mu.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("shared task was not admitted")
		}
		time.Sleep(time.Millisecond)
	}

	sharedResult := make(chan struct {
		value int
		err   error
	}, 1)
	go func() {
		value, err := waitRuntimeJob(context.Background(), sharedCall)
		sharedResult <- struct {
			value int
			err   error
		}{value: value, err: err}
	}()

	cancelCreator()
	if err := <-creatorDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("creator error = %v, want context.Canceled", err)
	}

	go group.worker()
	select {
	case <-workStarted:
	case <-time.After(time.Second):
		t.Fatal("shared admitted work did not execute")
	}
	select {
	case result := <-sharedResult:
		if result.err != nil || result.value != 42 {
			t.Fatalf("shared result = (%d, %v), want (42, nil)", result.value, result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("shared caller did not receive admitted work result")
	}
}

func TestRunOrderedJobsConvertsWorkerPanicToError(t *testing.T) {
	jobs := []orderedJob[int]{
		func(context.Context) (int, error) { return 1, nil },
		func(context.Context) (int, error) { panic("broken evaluator") },
	}
	_, err := runOrderedJobs(context.Background(), jobs, len(jobs))
	if err == nil || !strings.Contains(err.Error(), "broken evaluator") {
		t.Fatalf("panic error = %v, want recovered worker panic", err)
	}
}

func TestIndicatorRuntimeKeyUsesNormalizedCandleWindow(t *testing.T) {
	canonical := IndicatorRuntimeRequest{
		IndicatorType: "FVG",
		Candles: []Candle{
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
			{Time: 60, Open: 1, High: 2, Low: .5, Close: 1.5, Volume: 1},
		},
	}
	unsortedWithInvalid := canonical
	unsortedWithInvalid.Candles = []Candle{
		{Time: 0, Open: 99, High: 99, Low: 99, Close: 99, Volume: 99},
		canonical.Candles[1],
		canonical.Candles[0],
	}

	first, err := indicatorRuntimeKey(canonical)
	if err != nil {
		t.Fatal(err)
	}
	second, err := indicatorRuntimeKey(unsortedWithInvalid)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("equivalent normalized candle windows produced different keys: %q != %q", first, second)
	}
}

func TestRuntimeErrorStatusOnlyUsesTimeoutForContextErrors(t *testing.T) {
	for _, err := range []error{context.Canceled, context.DeadlineExceeded, fmt.Errorf("wrapped: %w", context.DeadlineExceeded)} {
		if status := runtimeErrorStatus(err); status != fiber.StatusRequestTimeout {
			t.Fatalf("runtimeErrorStatus(%v) = %d, want %d", err, status, fiber.StatusRequestTimeout)
		}
	}
	if status := runtimeErrorStatus(errors.New("runtime job panicked")); status != fiber.StatusInternalServerError {
		t.Fatalf("panic status = %d, want %d", status, fiber.StatusInternalServerError)
	}
	if status := runtimeErrorStatus(errRuntimeQueueFull); status != fiber.StatusServiceUnavailable {
		t.Fatalf("queue-full status = %d, want %d", status, fiber.StatusServiceUnavailable)
	}
}

func TestRuntimeResultIDTrimsInstanceIdentity(t *testing.T) {
	if got := runtimeResultID("  chart-id  ", "builtin"); got != "chart-id" {
		t.Fatalf("trimmed ID = %q", got)
	}
	if got := runtimeResultID("   ", "builtin"); got != "builtin" {
		t.Fatalf("blank ID = %q", got)
	}
}
