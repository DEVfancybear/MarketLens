package replay

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrBadRequest                = errors.New("replay: bad request")
	ErrNotFound                  = errors.New("replay: not found")
	ErrDataUnavailable           = errors.New("replay: data point unavailable")
	ErrDatasetPreparation        = errors.New("replay: dataset preparation failed")
	ErrVersionConflict           = errors.New("replay: version conflict")
	ErrSessionBusy               = errors.New("replay: session busy")
	ErrSessionClosed             = errors.New("replay: session closed")
	ErrCheckpointCorrupt         = errors.New("replay: checkpoint checksum mismatch")
	ErrUnsupportedReplayInterval = errors.New("replay: unsupported replay interval")
	ErrRewindRequiresFork        = errors.New("replay: rewind requires fork or trading reset")
)

type StartInput struct {
	Kind string    `json:"kind"`
	Time time.Time `json:"time"`
}

type TrackInput struct {
	Slot           int    `json:"slot"`
	Symbol         string `json:"symbol"`
	ChartTimeframe string `json:"chartTimeframe"`
	Required       bool   `json:"required,omitempty"`
}

type CreateSessionInput struct {
	Mode           string        `json:"mode"`
	Start          StartInput    `json:"start"`
	EndTime        *time.Time    `json:"endTime"`
	ReplayInterval string        `json:"replayInterval"`
	Speed          float64       `json:"speed"`
	Tracks         []TrackInput  `json:"tracks"`
	Trading        *TradingInput `json:"trading,omitempty"`
}

type TradingInput struct {
	Enabled        bool            `json:"enabled"`
	StartingEquity string          `json:"startingEquity"`
	BaseCurrency   string          `json:"baseCurrency"`
	Commission     json.RawMessage `json:"commission"`
	BarPathModel   string          `json:"barPathModel"`
}

type DatasetSnapshot struct {
	ID                  string    `json:"id"`
	DataKind            string    `json:"dataKind"`
	SourceTimeframe     string    `json:"sourceTimeframe"`
	BaseIntervalSeconds int       `json:"baseIntervalSeconds"`
	FirstAvailableTime  time.Time `json:"firstAvailableTime"`
	LastAvailableTime   time.Time `json:"lastAvailableTime"`
	SnapshotAt          time.Time `json:"snapshotAt"`
	RowCount            int       `json:"rowCount"`
	ChecksumSHA256      string    `json:"checksumSha256"`
	Status              string    `json:"status"`
}

type TrackSnapshot struct {
	ID             string          `json:"id"`
	Slot           int             `json:"slot"`
	Symbol         string          `json:"symbol"`
	Provider       string          `json:"provider"`
	MarketCalendar string          `json:"marketCalendar"`
	ChartTimeframe string          `json:"chartTimeframe"`
	CursorSeq      int64           `json:"cursorSeq"`
	VisibleThrough time.Time       `json:"visibleThrough"`
	Dataset        DatasetSnapshot `json:"dataset"`
	// InitialBars is populated only by session creation/fork responses. It lets
	// the browser activate the snapshot and its revealed candles atomically,
	// without an additional request per chart.
	InitialBars []ReplayBar `json:"initialBars,omitempty"`
}

type RevealedBarsSnapshot struct {
	SessionID      string      `json:"sessionId"`
	TrackID        string      `json:"trackId"`
	ChartTimeframe string      `json:"chartTimeframe"`
	CursorSeq      int64       `json:"cursorSeq"`
	VisibleThrough time.Time   `json:"visibleThrough"`
	Bars           []ReplayBar `json:"bars"`
}

type SessionSnapshot struct {
	ID                    string           `json:"id"`
	Status                string           `json:"status"`
	Mode                  string           `json:"mode"`
	Generation            int              `json:"generation"`
	Version               int64            `json:"version"`
	LastEventSeq          int64            `json:"lastEventSeq"`
	Speed                 float64          `json:"speed"`
	ReplayIntervalSeconds int              `json:"replayIntervalSeconds"`
	StartTime             time.Time        `json:"startTime"`
	SimulatedTime         time.Time        `json:"simulatedTime"`
	EndTime               *time.Time       `json:"endTime,omitempty"`
	PauseReason           string           `json:"pauseReason,omitempty"`
	Tracks                []TrackSnapshot  `json:"tracks"`
	Trading               *TradingSnapshot `json:"trading,omitempty"`
	CreatedAt             time.Time        `json:"createdAt"`
	UpdatedAt             time.Time        `json:"updatedAt"`
	ClosedAt              *time.Time       `json:"closedAt,omitempty"`
}

type ReplayAccount struct {
	BaseCurrency   string  `json:"baseCurrency"`
	StartingEquity float64 `json:"startingEquity"`
	Balance        float64 `json:"balance"`
	Equity         float64 `json:"equity"`
}

type ReplayOrder struct {
	ID             string    `json:"id"`
	TrackID        string    `json:"trackId"`
	ClientOrderID  string    `json:"clientOrderId"`
	Side           string    `json:"side"`
	OrderType      string    `json:"orderType"`
	Status         string    `json:"status"`
	Quantity       float64   `json:"quantity"`
	FilledQuantity float64   `json:"filledQuantity"`
	LimitPrice     *float64  `json:"limitPrice,omitempty"`
	StopPrice      *float64  `json:"stopPrice,omitempty"`
	TakeProfit     *float64  `json:"takeProfit,omitempty"`
	StopLoss       *float64  `json:"stopLoss,omitempty"`
	SubmittedAt    time.Time `json:"submittedAt"`
}

type ReplayFill struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"orderId"`
	TrackID     string    `json:"trackId"`
	DatasetSeq  int64     `json:"datasetSeq"`
	SimulatedAt time.Time `json:"simulatedAt"`
	Price       float64   `json:"price"`
	Quantity    float64   `json:"quantity"`
	Commission  float64   `json:"commission"`
}

type ReplayPosition struct {
	ID            string   `json:"id"`
	TrackID       string   `json:"trackId"`
	Symbol        string   `json:"symbol"`
	NetQuantity   float64  `json:"netQuantity"`
	AveragePrice  float64  `json:"averagePrice"`
	RealizedPnL   float64  `json:"realizedPnl"`
	UnrealizedPnL float64  `json:"unrealizedPnl"`
	StopLoss      *float64 `json:"stopLoss,omitempty"`
	TakeProfit    *float64 `json:"takeProfit,omitempty"`
}

type TradingSnapshot struct {
	Account   ReplayAccount    `json:"account"`
	Orders    []ReplayOrder    `json:"orders"`
	Fills     []ReplayFill     `json:"fills"`
	Positions []ReplayPosition `json:"positions"`
}

type ReplayReport struct {
	SessionID     string        `json:"sessionId"`
	GeneratedAt   time.Time     `json:"generatedAt"`
	Account       ReplayAccount `json:"account"`
	ClosedTrades  int           `json:"closedTrades"`
	WinningTrades int           `json:"winningTrades"`
	LosingTrades  int           `json:"losingTrades"`
	NetPnL        float64       `json:"netPnl"`
	MaxDrawdown   float64       `json:"maxDrawdown"`
	Fills         []ReplayFill  `json:"fills"`
}

type CommandInput struct {
	IdempotencyKey  string          `json:"idempotencyKey"`
	ExpectedVersion *int64          `json:"expectedVersion,omitempty"`
	Type            string          `json:"type"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	ActorOwner      string          `json:"-"`
	ActorLeaseUntil time.Time       `json:"-"`
}

type ForkSessionInput struct {
	Time time.Time `json:"time"`
}

type CommandResult struct {
	CommandID string          `json:"commandId"`
	Status    string          `json:"status"`
	Duplicate bool            `json:"duplicate"`
	Snapshot  SessionSnapshot `json:"snapshot"`
}

type EventEnvelope struct {
	SessionID     string          `json:"sessionId"`
	EventSeq      int64           `json:"eventSeq"`
	Version       int64           `json:"version"`
	SimulatedTime time.Time       `json:"simulatedTime"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
}

type VersionConflictError struct{ CurrentVersion int64 }

func (e *VersionConflictError) Error() string { return ErrVersionConflict.Error() }
func (e *VersionConflictError) Unwrap() error { return ErrVersionConflict }

type DataUnavailableError struct {
	FirstAvailable time.Time
	LastAvailable  time.Time
	Slot           int
	Symbol         string
	ChartTimeframe string
}

func (e *DataUnavailableError) Error() string { return ErrDataUnavailable.Error() }
func (e *DataUnavailableError) Unwrap() error { return ErrDataUnavailable }

type Bar struct {
	Time   time.Time
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume float64
}

type PreparedTrack struct {
	Slot            int
	Symbol          string
	Provider        string
	MarketCalendar  string
	ChartTimeframe  string
	SourceTimeframe string
	IntervalSeconds int
	RequestedStart  time.Time
	CursorSeq       int64
	VisibleThrough  time.Time
	Checksum        string
	SnapshotAt      time.Time
	SourceMeta      []byte
	AggregateState  []byte
	Bars            []Bar
	InitialBars     []ReplayBar
}

type PreparedSession struct {
	Mode                  string
	Speed                 float64
	ReplayIntervalSeconds int
	StartTime             time.Time
	EndTime               *time.Time
	Config                []byte
	Tracks                []PreparedTrack
	Trading               *PreparedTrading
}

type PreparedTrading struct {
	StartingEquity float64
	BaseCurrency   string
	Commission     []byte
}

type CleanupResult struct {
	Sessions int64
	Datasets int64
}
