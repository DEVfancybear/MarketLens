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
)

type StartInput struct {
	Kind string    `json:"kind"`
	Time time.Time `json:"time"`
}

type TrackInput struct {
	Slot           int    `json:"slot"`
	Symbol         string `json:"symbol"`
	ChartTimeframe string `json:"chartTimeframe"`
}

type CreateSessionInput struct {
	Mode           string       `json:"mode"`
	Start          StartInput   `json:"start"`
	EndTime        *time.Time   `json:"endTime"`
	ReplayInterval string       `json:"replayInterval"`
	Speed          float64      `json:"speed"`
	Tracks         []TrackInput `json:"tracks"`
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
	ChartTimeframe string          `json:"chartTimeframe"`
	CursorSeq      int64           `json:"cursorSeq"`
	VisibleThrough time.Time       `json:"visibleThrough"`
	Dataset        DatasetSnapshot `json:"dataset"`
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
	ID                    string          `json:"id"`
	Status                string          `json:"status"`
	Mode                  string          `json:"mode"`
	Generation            int             `json:"generation"`
	Version               int64           `json:"version"`
	LastEventSeq          int64           `json:"lastEventSeq"`
	Speed                 float64         `json:"speed"`
	ReplayIntervalSeconds int             `json:"replayIntervalSeconds"`
	StartTime             time.Time       `json:"startTime"`
	SimulatedTime         time.Time       `json:"simulatedTime"`
	EndTime               *time.Time      `json:"endTime,omitempty"`
	PauseReason           string          `json:"pauseReason,omitempty"`
	Tracks                []TrackSnapshot `json:"tracks"`
	CreatedAt             time.Time       `json:"createdAt"`
	UpdatedAt             time.Time       `json:"updatedAt"`
	ClosedAt              *time.Time      `json:"closedAt,omitempty"`
}

type CommandInput struct {
	IdempotencyKey  string          `json:"idempotencyKey"`
	ExpectedVersion *int64          `json:"expectedVersion,omitempty"`
	Type            string          `json:"type"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	ActorOwner      string          `json:"-"`
	ActorLeaseUntil time.Time       `json:"-"`
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
}

type PreparedSession struct {
	Mode                  string
	Speed                 float64
	ReplayIntervalSeconds int
	StartTime             time.Time
	EndTime               *time.Time
	Config                []byte
	Tracks                []PreparedTrack
}

type CleanupResult struct {
	Sessions int64
	Datasets int64
}
