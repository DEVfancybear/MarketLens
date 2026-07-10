package replay

import (
	"errors"
	"time"
)

var (
	ErrBadRequest         = errors.New("replay: bad request")
	ErrNotFound           = errors.New("replay: not found")
	ErrDataUnavailable    = errors.New("replay: data point unavailable")
	ErrDatasetPreparation = errors.New("replay: dataset preparation failed")
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

type SessionSnapshot struct {
	ID                    string          `json:"id"`
	Status                string          `json:"status"`
	Mode                  string          `json:"mode"`
	Generation            int             `json:"generation"`
	Version               int64           `json:"version"`
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
	IntervalSeconds int
	RequestedStart  time.Time
	CursorSeq       int64
	VisibleThrough  time.Time
	Checksum        string
	SnapshotAt      time.Time
	SourceMeta      []byte
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
